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

    var HOT_KEYS = [9, 13, 27, 32, 38, 40];

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
            var onSelectCallback = $parse(attrs.typeaheadOnSelect);

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

            var getMatchId = function(index) {
                return popupId + '-option-' + index;
            };

            var getMatchesAsync = function(inputValue) {

                var locals = {$viewValue: inputValue};
                isLoadingSetter(originalScope, true);

                $q.when(parserResult.source(originalScope, locals)).then(function(matches) {
                    //it might happen that several async queries were in progress if a user were typing fast
                    //but we are interested only in responses that correspond to the current view value

                    // this doesn't work because it doesn't parse the current view value properly.
                    
                    
                    var onCurrentRequest = modelCtrl.$viewValue.indexOf(inputValue) > -1;

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

                            scope.query = inputValue;

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
            element.bind('keypress', function (evt) {
                //bind keyboard events: arrows up(38) / down(40), enter(13) and tab(9), esc(27)
                //typeahead is open and an "interesting" key was pressed

                if(scope.activeIdx === -1 && evt.which === 13){
                    // YOU ARE WORKING ON THIS
                    //  Send message to postmessage once tags are assembled
                    //  then return the resulting message to the originalScope
                    // and add it to whatever context the message is supposed to live in
                    // on whatever page.
                    
                    
                    scope.$emit('message', modelCtrl.$viewValue);
                    modelCtrl.$setViewValue('');
                    modelCtrl.$render();

                    scope.testTags=[];
                    evt.stopPropagation();
                    resetMatches();
                    scope.$digest();
                }

                if (scope.matches.length === 0 || HOT_KEYS.indexOf(evt.which) === -1) {
                    return;
                }

                // if there's nothing selected (i.e. focusFirst) and enter is hit, don't do anything
                if (scope.activeIdx === -1 && (evt.which === 13 || evt.which === 9)) {
                    return;
                }

                if (evt.which === 32) {
                    // add a space to the model and cancel the dropdown
                    
                    // var newValue = modelCtrl.$viewValue + ' ';
                    // modelCtrl.$viewValue doesn't work here.

                    evt.stopPropagation();
                    resetMatches();
                    scope.$digest();
                    
                } else {
                    evt.preventDefault();

                    if (evt.which === 40) {
                        // down arrow key
                        
                        scope.activeIdx = (scope.activeIdx + 1) % scope.matches.length;
                        
                        scope.$digest();

                    } else if (evt.which === 38) {
                        
                        scope.activeIdx = (scope.activeIdx > 0 ? scope.activeIdx : scope.matches.length) - 1;
                        scope.$digest();

                    } else if (evt.which === 13 || evt.which === 9) {
                        
                        
                        scope.$apply(function() {
                            scope.select(scope.activeIdx);
                            resetMatches();
                            
                        })
                    } else if (evt.which === 27) {
                        
                        evt.stopPropagation();
                        resetMatches();
                        scope.$digest(); // here, this makes esc work.
                    } 
                }
            });

            element.bind('blur', function (evt) {
                hasFocus = false;
            });


            var modelParser = function (inputValue) {
                // Step through the model and do things with the input value
                // begin parsing an entry on a hashtag
                // if you want to do a separate type of input, match on @?

                // TODO: Abstract so there can be preferred variables set above to load different data sets.
                // in input value, when hashtag is clicked,
                // then when the tag is set, disable this
                // then when tag is clicked, fire parser again.

                // When a matching tag is selected, mark the appropriate tag as used

                // TODO:
                // insert the tag as a clickable link to dropdown menu of existing options
                var tester = inputValue.match(/\S*#\S+/gi);
                var tag_body; 
                
                // okay, so now we have a list of tags in scope.testTags...
                if(tester && tester.length > 0 && tester.length > scope.testTags.length){
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
               
                // TODO: Make this match only the +current+ scope.query
                // this is rough because it will replace all hashes that match the scope.query, 
                // not _just_ the scope.query.

                // insert the new tag into the input box
                var newValue = modelCtrl.$viewValue.replace('#'+scope.query, '#'+model);

                modelCtrl.$setViewValue(newValue);
                modelCtrl.$render();

                modelCtrl.$setValidity('editable', true);

                // add the new tag to scope.testTags...
                scope.testTags.push('#'+model);
                // This is to insert a more complex model item into the feed. 
                // it overwrites the main index field, too.
                onSelectCallback(originalScope, {
                    $item: item,
                    $model: model,
                    $label: parserResult.viewMapper(originalScope, locals)
                });
                
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
        "<ul class=\"dropdown-menu\" ng-show=\"isOpen()\" ng-style=\"{top: position.top+'px', left: position.left+'px'}\" style=\"display: block;\" role=\"listbox\" aria-hidden=\"{{!isOpen()}}\">\n" +
        "        <li ng-repeat=\"match in matches track by $index\" ng-class=\"{active: isActive($index) }\" ng-mouseenter=\"selectActive($index)\" ng-click=\"selectMatch($index)\" role=\"option\" id=\"{{match.id}}\">\n" +
        "                <div typeahead-match index=\"$index\" match=\"match\" query=\"query\" template-url=\"templateUrl\"></div>\n" +
        "        </li>\n" +
        "</ul>\n" +
        "");
}]);
