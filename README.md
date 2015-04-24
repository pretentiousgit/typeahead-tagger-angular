# typeahead-tagger-angular
An Angular directive to supply twitter-style text entry with hashtag support.

### Use
Include in vendor JS file and gulp as normal.

Add to main Angular module with "typeaheadTagger":  
```angular.module('myModule',['typeaheadTagger']);
```

Use within HTML partials by calling 'typeahead' attribute and setting options:  
```<input type="textarea" ng-model="typeinput" typeahead="tag.name for tag in tags | filter:$viewValue | limitTo:8">
```  

In code, typeahead relies on an array list of objects, provided however one would like - [Bloodhound](https://github.com/twitter/typeahead.js/blob/master/doc/bloodhound.md "Bloodhound") by Twitter for the Twitter typeahead engine is a good one. It then repeats that list, allowing you to select the field you wish to appear in the list.

#### Options

keyOff     : The character to match to fire typeahead menu (not working in 0.1)

minLength  : Minimum length of typing after '#' to fire matcher

waitMs     : minimal wait time after last character typed before typehead kicks-in

isEditable : should it restrict model values to the ones selected from the popup only?

loading    : Are matches being returned asynchronously?

onSelect   : A callback fired on selection

limitTo    : Maximum number of results permitted as a match

focusFirst : Should the first match in the list have automatic focus?


### Expected Behaviour

* Sniffs for '#' character and fires a match sequence on detection
* Breaks on use of space, on use of tab, or on first use of enter (key 13)
* Emits body of input field to parent scope/up-chain on enter if popup menu is not visible

### Acknowledgements

Based on [ui.bootstrap.typeahead](https://angular-ui.github.io/bootstrap/).