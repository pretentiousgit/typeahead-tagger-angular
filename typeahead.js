/* *
 * typeaheadTagger, based on angular-ui-bootstrap-typeahead
 * Takes an optional keyoff character to list available entries in a typeahead input box.
 * http://www.github.com/pretentiousgit/typeaheadTagger
 *  
 * angular-ui-bootstrap
 * http://angular-ui.github.io/bootstrap/

 * Version: 0.1 - 2015-04-24
 * License: MIT
 */
'use strict';

angular.module("typeaheadTagger", ["typeaheadTpls","typeaheadInputBox","DOMposition","bindHtml"]);
angular.module("typeaheadTpls", ["typeahead-match.html","typeahead-popup.html"]);
angular.module('typeaheadInputBox', ['DOMposition', 'bindHtml'])

/* *
 * A helper service that can parse typeahead's syntax (string provided by users)
 * Extracted to a separate service for ease of unit testing
 */

.factory('typeaheadParser', ['$parse', function ($parse) {
    var TYPEAHEAD_REGEXP = /^\s*([\s\S]+?)(?:\s+as\s+([\s\S]+?))?\s+for\s+(?:([\$\w][\$\w\d]*))\s+in\s+([\s\S]+?)$/;
                
    return {
        parse:function (input) {
        var match = input.match(TYPEAHEAD_REGEXP);
        if (!match) {
            throw new Error(
                'Expected typeahead specification in form of "_modelValue_ (as _label_)? for _item_ in _collection_"' +
                    ' but got "' + input + '".');
        }

        return {
            itemName:match[3],
            source:$parse(match[4]),
            viewMapper:$parse(match[2] || match[1]),
            modelMapper:$parse(match[1])
        };
    
        }
    };
}])

.directive('typeahead', ['$compile', '$parse', '$q', '$timeout', '$document', '$position', 'typeaheadParser',
    function ($compile, $parse, $q, $timeout, $document, $position, typeaheadParser) {

    var HOT_KEYS = [9, 13, 27, 32, 38, 40, 46];

    return {
        require:'ngModel',
        link:function (originalScope, element, attrs, modelCtrl) {

            //SUPPORTED ATTRIBUTES (OPTIONS)

            // Which key to check for to key off match process?
            var keyOff = originalScope.$eval(attrs.typeaheadKeyOff) || '#';

            //minimal no of characters that needs to be entered before typeahead kicks-in
            var minSearch = originalScope.$eval(attrs.typeaheadMinLength) || 1;

            //minimal wait time after last character typed before typehead kicks-in
            var waitTime = originalScope.$eval(attrs.typeaheadWaitMs) || 0;

            //should it restrict model values to the ones selected from the popup only?
            var isEditable = originalScope.$eval(attrs.typeaheadEditable) !== false;

            //binding to a variable that indicates if matches are being retrieved asynchronously
            var isLoadingSetter = $parse(attrs.typeaheadLoading).assign || angular.noop;

            //a callback executed when a match is selected
            // var onSelectCallback = $parse(attrs.typeaheadOnSelect);

            // var inputFormatter = attrs.typeaheadInputFormatter ? $parse(attrs.typeaheadInputFormatter) : undefined;

            var appendToBody =    attrs.typeaheadAppendToBody ? originalScope.$eval(attrs.typeaheadAppendToBody) : false;

            var focusFirst = originalScope.$eval(attrs.typeaheadFocusFirst) !== false;

    // INTERNAL VARIABLES =======================

            // where to insert the new element inside the original type-area
            var insertionModelVariable = $parse(attrs.ngModel);
            var insertionIndex;
            
            //expressions used by typeahead
            var parserResult = typeaheadParser.parse(attrs.typeahead);

            //Declare the timeout promise var outside the function scope so that stacked calls can be cancelled later
            var hasFocus, timeoutPromise;


            //create a child scope for the typeahead directive so we are not polluting original scope
            //with typeahead-specific data (matches, query etc.)
            var scope = originalScope.$new();
                scope.testTags = [];
                scope.inputValue = '';
                scope.caret = {};

            // WAI-ARIA
            var popupId = 'typeahead-' + scope.$id + '-' + Math.floor(Math.random() * 10000);

            element.attr({
                'aria-autocomplete': 'list',
                'aria-expanded': false,
                'aria-owns': popupId
            });

            //pop-up element used to display matches
            var popUpEl = angular.element('<div typeahead-popup></div>');
            popUpEl.attr({
                id: popupId,
                matches: 'matches',
                active: 'activeIdx',
                select: 'select(activeIdx)',
                query: 'query',
                position: 'position'
            });

            //custom item template
            if (angular.isDefined(attrs.typeaheadTemplateUrl)) {
                popUpEl.attr('template-url', attrs.typeaheadTemplateUrl);
            }

    // FUNCTIONS LIST ===========================

            var resetMatches = function() {
                scope.matches = [];
                scope.activeIdx = -1;
                element.attr('aria-expanded', false);
            };


            var scheduleSearchWithTimeout = function(inputValue) {
                timeoutPromise = $timeout(function () {
                    getMatchesAsync(inputValue);
                }, waitTime);
            };

            var cancelPreviousTimeout = function() {
                if (timeoutPromise) {
                    $timeout.cancel(timeoutPromise);
                }
            };

            var dismissClickHandler = function (evt) {
                // Keep reference to click handler to unbind it.
                if (element[0] !== evt.target) {
                    resetMatches();
                    evt.stopPropagation();
                }
            };
            
            function spliceSlice(str, index, count, add) {
              return str.slice(0, index) + (add || "") + str.slice(index + count);
            }

            function getPos(element) {
                if ('selectionStart' in element) {
                  return element.selectionStart;
                } else if (document.selection) {
                  element.focus();
                  var sel = document.selection.createRange();
                  var selLen = document.selection.createRange().text.length;
                  sel.moveStart('character', -element.value.length);
                  return sel.text.length - selLen;
                }
              }

            function setPos(element, caretPos) {
                if (element.createTextRange) {
                  var range = element.createTextRange();
                  range.move('character', caretPos);
                  range.select();
                } else {
                  element.focus();
                  if (element.selectionStart !== undefined) {
                    element.setSelectionRange(caretPos, caretPos);
                  }
                }
              }

            var matchTags = function(stringValue){
                return stringValue.match(/\S*#[^\.\,\!\?\s]+/gi);
            }

            var getMatchId = function(index) {
                return popupId + '-option-' + index;
            };

            var getMatchesAsync = function(inputValue) {
                var mostRecentHash = modelCtrl.$viewValue.lastIndexOf('#', scope.caret.get);
                var nextSpace      = modelCtrl.$viewValue.indexOf(' ', mostRecentHash);

                var searchClose    = (nextSpace && nextSpace > -1) ? Math.min(nextSpace, scope.caret.get) : scope.caret.get;
                var searchTerm     = modelCtrl.$viewValue.substr(mostRecentHash+1, searchClose-mostRecentHash);
                    
                var locals = {$viewValue: searchTerm};
                isLoadingSetter(originalScope, true);

                $q.when(parserResult.source(originalScope, locals)).then(function(matches) {
                    //it might happen that several async queries were in progress if a user were typing fast
                    //but we are interested only in responses that correspond to the current view value

                    var onCurrentRequest = modelCtrl.$viewValue.indexOf(searchTerm) > -1;

                    if (onCurrentRequest && hasFocus) {
                        if (matches.length > 0) {
                            scope.activeIdx = focusFirst ? 0 : -1;
                            scope.matches.length = 0;

                            //transform labels
                            for(var i=0; i<matches.length; i++) {
                                locals[parserResult.itemName] = matches[i];
                                scope.matches.push({
                                    id: getMatchId(i),
                                    label: parserResult.viewMapper(scope, locals),
                                    model: matches[i]
                                });
                            }

                            scope.query = searchTerm;
                            //position pop-up with matches - we need to re-calculate its position each time we are opening a window
                            //with matches as a pop-up might be absolute-positioned and position of an input might have changed on a page
                            //due to other elements being rendered
                            scope.position = appendToBody ? $position.offset(element) : $position.position(element);
                            scope.position.top = scope.position.top + element.prop('offsetHeight');

                            element.attr('aria-expanded', true);
                        } else {
                            resetMatches();
                        }
                    }
                    if (onCurrentRequest) {
                        isLoadingSetter(originalScope, false);
                    }

                }, function(){
                    resetMatches();
                    isLoadingSetter(originalScope, false);
                });
            };

            var modelParser = function (inputValue) {

                // Step through the model and do things with the input value
                // begin parsing an entry on a hashtag
                // if you want to do a separate type of input, match on any-character other than punctuation?

                var tester = matchTags(inputValue);
                var accepted_tags = inputValue.match(/#[^\.\,\!\?\s]*\s/gi);
                var tag_body, clean_accepted = [],clean_test = [], difference; 

                scope.testTags = inputValue.match(/#[^\.\,\!\?\s]*\s/gi);
                
                if(accepted_tags){
                    _.map(accepted_tags, function(n){
                            n = n.replace(/#/gi, '');
                            n = n.replace(/\s/gi,  '');
                            return clean_accepted.push(n);
                    })
                }

                if(tester){
                    _.map(tester, function(n){
                        n = n.replace(/#/gi,  '');
                        n = n.replace(/\s/gi,  '');
                        return clean_test.push(n);
                    })
                }

                if(accepted_tags && tester){
                    difference = _.difference(clean_test, clean_accepted);
                }

                // WHAT WE HAVE
                // if we have a match on a hashtag
                // the length of the matched hashtag values is greater than zero
                // and greater than the number of tags already posted to the test
                // make a new tag, and then open up the replacement schema.

                // WHAT WE WANT
                // we have a list of all tags in the input
                // we need a separate scope that watches "accepted" tags
                // when a hashtag is opened, open the typeahead menu and match on it
                // if the tag is altered, reopen the menu on the altered tag
                // when a space is entered, close the match

                // if a hashtag is deleted or altered, re-count the number of tags
                // enter all updated tags into scope.testTags

                // in here, we need to test if the new tag already exists in the list or has replaced something else 

                if(tester && tester.length > 0 && (!accepted_tags || tester.length > accepted_tags.length)){
                    tag_body = tester[tester.length -1].replace(/#/gi,'');
                }

                var locals = {$viewValue: inputValue};
                
                hasFocus = true;

                // if we have a match on a hashtag
                // and the length of the newest hashtag value is greater than zero
                // get matches 

                if (tag_body && tag_body.length >= minSearch) {
                    // in here check matches on latest message
                    if (waitTime > 0) {
                        cancelPreviousTimeout();
                        scheduleSearchWithTimeout(tag_body);
                    } else {
                        getMatchesAsync(tag_body);
                    }
                } else {
                    isLoadingSetter(originalScope, false);
                    cancelPreviousTimeout();
                    resetMatches();
                }

                if (isEditable) {
                    return tag_body;
                } else {
                    if (!tag_body) {
                        // Reset in case user had typed something previously.
                        modelCtrl.$setValidity('editable', true);
                        return tag_body;
                    } else {
                        modelCtrl.$setValidity('editable', false);
                        return undefined;
                    }
                }
            };
       
        // ACTUAL FUNCTION ======================
            // Indicate that the specified match is the active (pre-selected) item in the list owned by this typeahead.
            // This attribute is added or removed automatically when the `activeIdx` changes.
            scope.$watch('activeIdx', function(index) {
                if (index < 0) {
                    element.removeAttr('aria-activedescendant');
                } else {
                    element.attr('aria-activedescendant', getMatchId(index));
                }
            });

            // As we get started, clear the match index.
            resetMatches();

            //we need to propagate user's query so we can highlight matches.
            scope.query = undefined;

        // Bind KEY EVENTS - may have to be KEYDOWN ======================================

            var enterCount = 0; // can't seem to get enter to work properly, hack hack hack

            element.bind('keypress keydown', function (evt) {
                //bind keyboard events: arrows up(38) / down(40), enter(13) and tab(9), esc(27)
                //typeahead is open and an "interesting" key was pressed

                // Set the caret position so we can effectively hunt hashtags
                scope.$apply(function() { scope.caret.get = getPos(element[0]); });

                console.log('keypress', evt.which, scope.activeIdx);

                if(scope.activeIdx === -1 && evt.which === 13){
                    // EMIT COMPLETED MESSAGE =============================
                    //  Send message to postmessage once tags are assembled
                    //  then return the resulting message to the originalScope
                    //  send the message back to the parent context of the directive
                    
                    evt.preventDefault();
                    scope.$emit('message', modelCtrl.$viewValue);
                    modelCtrl.$setViewValue('');
                    modelCtrl.$render();

                    scope.testTags=[];
                    evt.stopPropagation();
                    resetMatches();
                    scope.$digest();
                }

                if (evt.which === 32) {
                    // SPACE keypress =========
                    // add a space to the model and cancel the dropdown
                    // post the tag to the scope-tags for comparision
                    evt.stopPropagation();
                    resetMatches();
                    scope.$digest();
                } 

                if (scope.matches.length === 0 || HOT_KEYS.indexOf(evt.which) === -1) {
                    return;
                }

                // if there's nothing selected (i.e. focusFirst) and enter is hit, don't do anything
                if (scope.activeIdx === -1 && (evt.which === 13 || evt.which === 9)) {
                    resetMatches();
                    scope.$digest();
                    return;
                } else {
                    evt.preventDefault();

                    if (evt.which === 40) {
                        // DOWN keypress =========
                        
                        scope.activeIdx = (scope.activeIdx + 1) % scope.matches.length;
                        
                        scope.$digest();

                    } else if (evt.which === 38) {
                        // UP keypress =========
                        scope.activeIdx = (scope.activeIdx > 0 ? scope.activeIdx : scope.matches.length) - 1;
                        scope.$digest();

                    } else if (evt.which === 13 || evt.which === 9) {
                        
                        console.log(enterCount);
                        // ENTER or TAB keypress =========

                        if(enterCount === 0){
                            scope.$apply(function() {
                                scope.select(scope.activeIdx);
                                resetMatches();
                                enterCount++
                            })
                        } else {
                            enterCount = 0;
                            evt.stopPropagation();
                            resetMatches();
                            scope.$digest();   
                        }

                    } else if (evt.which === 27) {
                        // ESC keypress =========
                        evt.stopPropagation();
                        resetMatches();
                        scope.$digest(); // here, this makes esc work.
                    } 
                }
            });

            element.bind('blur', function (evt) {
                hasFocus = false;
            });

            //plug into $parsers pipeline to open a typeahead on view changes initiated from DOM
            //$parsers kick-in on all the changes coming from the view as well as manually triggered by $setViewValue
            modelCtrl.$parsers.unshift(function (inputValue){
                modelParser(inputValue);
            });


            scope.select = function (activeIdx) {
                // this is how we pick a matched tag and insert it into the message. 
                // called from within the $digest() cycle
                var locals = {};
                var model, item;

                locals[parserResult.itemName] = item = scope.matches[activeIdx].model;
                model = parserResult.modelMapper(originalScope, locals);
                // Find the most recent hashtag from the current caret position
                var mostRecentHash = modelCtrl.$viewValue.lastIndexOf('#', scope.caret.get)
                var newValue  = spliceSlice(modelCtrl.$viewValue, mostRecentHash, scope.caret.get-mostRecentHash, '#'+model);

                modelCtrl.$setViewValue(newValue);

                modelCtrl.$render();

                modelCtrl.$setValidity('editable', true);

                // This is to insert a more complex model item into the feed. 
                // it overwrites the main index field, too.
                // onSelectCallback(originalScope, {
                //     $item: item,
                //     $model: model,
                //     $label: parserResult.viewMapper(originalScope, locals)
                // });
                
                //return focus to the input element if a match was selected via a mouse click event
                // use timeout to avoid $rootScope:inprog error
                $timeout(function() { element[0].focus(); }, 0, false);
            };

            // Dismiss click handlers on the click of a general document click
            // or on the original scope being clicked.
            $document.bind('click', dismissClickHandler);

            originalScope.$on('$destroy', function(){
                $document.unbind('click', dismissClickHandler);
                if (appendToBody) {
                    $popup.remove();
                }
                scope.$destroy();
            });

            var $popup = $compile(popUpEl)(scope);

            if (appendToBody) {
                $document.find('body').append($popup);
            } else {
                element.after($popup);
            }
        }
    };

}])

    .directive('typeaheadPopup', function () {
        return {
            restrict:'EA',
            scope:{
                matches:'=',
                query:'=',
                active:'=',
                position:'=',
                select:'&'
            },
            replace:true,
            templateUrl:'typeahead-popup.html',
            link:function (scope, element, attrs) {

                scope.templateUrl = attrs.templateUrl;

                scope.isOpen = function () {
                    return scope.matches.length > 0;
                };

                scope.isActive = function (matchIdx) {
                    return scope.active === matchIdx;
                };

                scope.selectActive = function (matchIdx) {
                    
                    scope.active = matchIdx;
                };

                scope.selectMatch = function (activeIdx) {
                    
                    scope.select({activeIdx:activeIdx});
                };
            }
        };
    })

    .directive('typeaheadMatch', ['$http', '$templateCache', '$compile', '$parse', function ($http, $templateCache, $compile, $parse) {
        return {
            restrict:'EA',
            scope:{
                index:'=',
                match:'=',
                query:'='
            },
            link:function (scope, element, attrs) {
                var tplUrl = $parse(attrs.templateUrl)(scope.$parent) || 'typeahead-match.html';
                $http.get(tplUrl, {cache: $templateCache}).success(function(tplContent){
                     element.replaceWith($compile(tplContent.trim())(scope));
                });
            }
        };
    }])

    .filter('typeaheadHighlight', function() {

        function escapeRegexp(queryToEscape) {
            return queryToEscape.replace(/([.?*+^$[\]\\(){}|-])/g, '\\$1');
        }

        return function(matchItem, query) {
            return query ? ('' + matchItem).replace(new RegExp(escapeRegexp(query), 'gi'), '<strong>$&</strong>') : matchItem;
        };
    });

angular.module('DOMposition', [])

/* *
 * angular-ui-bootstrap
 * http://angular-ui.github.io/bootstrap/
 * Version: 0.12.1 - 2015-02-20
 * License: MIT
 */

/* *
 * A set of utility methods that can be use to retrieve position of DOM elements.
 * It is meant to be used where we need to absolute-position DOM elements in
 * relation to other, existing elements (this is the case for tooltips, popovers,
 * typeahead suggestions etc.).
 */
    .factory('$position', ['$document', '$window', function ($document, $window) {

        function getStyle(el, cssprop) {
            if (el.currentStyle) { //IE
                return el.currentStyle[cssprop];
            } else if ($window.getComputedStyle) {
                return $window.getComputedStyle(el)[cssprop];
            }
            // finally try and get inline style
            return el.style[cssprop];
        }

        /**
         * Checks if a given element is statically positioned
         * @param element - raw DOM element
         */
        function isStaticPositioned(element) {
            return (getStyle(element, 'position') || 'static' ) === 'static';
        }

        /**
         * returns the closest, non-statically positioned parentOffset of a given element
         * @param element
         */
        var parentOffsetEl = function (element) {
            var docDomEl = $document[0];
            var offsetParent = element.offsetParent || docDomEl;
            while (offsetParent && offsetParent !== docDomEl && isStaticPositioned(offsetParent) ) {
                offsetParent = offsetParent.offsetParent;
            }
            return offsetParent || docDomEl;
        };

        return {
            /**
             * Provides read-only equivalent of jQuery's position function:
             * http://api.jquery.com/position/
             */
            position: function (element) {
                var elBCR = this.offset(element);
                var offsetParentBCR = { top: 0, left: 0 };
                var offsetParentEl = parentOffsetEl(element[0]);
                if (offsetParentEl != $document[0]) {
                    offsetParentBCR = this.offset(angular.element(offsetParentEl));
                    offsetParentBCR.top += offsetParentEl.clientTop - offsetParentEl.scrollTop;
                    offsetParentBCR.left += offsetParentEl.clientLeft - offsetParentEl.scrollLeft;
                }

                var boundingClientRect = element[0].getBoundingClientRect();
                return {
                    width: boundingClientRect.width || element.prop('offsetWidth'),
                    height: boundingClientRect.height || element.prop('offsetHeight'),
                    top: elBCR.top - offsetParentBCR.top,
                    left: elBCR.left - offsetParentBCR.left
                };
            },

            /**
             * Provides read-only equivalent of jQuery's offset function:
             * http://api.jquery.com/offset/
             */
            offset: function (element) {
                var boundingClientRect = element[0].getBoundingClientRect();
                return {
                    width: boundingClientRect.width || element.prop('offsetWidth'),
                    height: boundingClientRect.height || element.prop('offsetHeight'),
                    top: boundingClientRect.top + ($window.pageYOffset || $document[0].documentElement.scrollTop),
                    left: boundingClientRect.left + ($window.pageXOffset || $document[0].documentElement.scrollLeft)
                };
            },

            /**
             * Provides coordinates for the targetEl in relation to hostEl
             */
            positionElements: function (hostEl, targetEl, positionStr, appendToBody) {

                var positionStrParts = positionStr.split('-');
                var pos0 = positionStrParts[0], pos1 = positionStrParts[1] || 'center';

                var hostElPos,
                    targetElWidth,
                    targetElHeight,
                    targetElPos;

                hostElPos = appendToBody ? this.offset(hostEl) : this.position(hostEl);

                targetElWidth = targetEl.prop('offsetWidth');
                targetElHeight = targetEl.prop('offsetHeight');

                var shiftWidth = {
                    center: function () {
                        return hostElPos.left + hostElPos.width / 2 - targetElWidth / 2;
                    },
                    left: function () {
                        return hostElPos.left;
                    },
                    right: function () {
                        return hostElPos.left + hostElPos.width;
                    }
                };

                var shiftHeight = {
                    center: function () {
                        return hostElPos.top + hostElPos.height / 2 - targetElHeight / 2;
                    },
                    top: function () {
                        return hostElPos.top;
                    },
                    bottom: function () {
                        return hostElPos.top + hostElPos.height;
                    }
                };

                switch (pos0) {
                    case 'right':
                        targetElPos = {
                            top: shiftHeight[pos1](),
                            left: shiftWidth[pos0]()
                        };
                        break;
                    case 'left':
                        targetElPos = {
                            top: shiftHeight[pos1](),
                            left: hostElPos.left - targetElWidth
                        };
                        break;
                    case 'bottom':
                        targetElPos = {
                            top: shiftHeight[pos0](),
                            left: shiftWidth[pos1]()
                        };
                        break;
                    default:
                        targetElPos = {
                            top: hostElPos.top - targetElHeight,
                            left: shiftWidth[pos1]()
                        };
                        break;
                }

                return targetElPos;
            }
        };
    }]);

angular.module('bindHtml', [])

    .directive('bindHtmlUnsafe', function () {
        return function (scope, element, attr) {
            element.addClass('ng-binding').data('$binding', attr.bindHtmlUnsafe);
            scope.$watch(attr.bindHtmlUnsafe, function bindHtmlUnsafeWatchAction(value) {
                element.html(value || '');
            });
        };
    });

angular.module("typeahead-match.html", []).run(["$templateCache", function($templateCache) {
    $templateCache.put("typeahead-match.html",
        "<a tabindex=\"-1\" bind-html-unsafe=\"match.label | typeaheadHighlight:query\"></a>");
}]);

angular.module("typeahead-popup.html", []).run(["$templateCache", function($templateCache) {
    $templateCache.put("typeahead-popup.html",
        "<ul class=\"dropdown-menu\" ng-show=\"isOpen()\" ng-style=\"{bottom:'100%', left: position.left+'px', position:'absolute'}\" style=\"display: block;\" role=\"listbox\" aria-hidden=\"{{!isOpen()}}\">\n" +
        "        <li ng-repeat=\"match in matches track by $index\" ng-class=\"{active: isActive($index) }\" ng-mouseenter=\"selectActive($index)\" ng-click=\"selectMatch($index)\" role=\"option\" id=\"{{match.id}}\">\n" +
        "                <div typeahead-match index=\"$index\" match=\"match\" query=\"query\" template-url=\"templateUrl\"></div>\n" +
        "        </li>\n" +
        "</ul>\n" +
        "");
}]);
