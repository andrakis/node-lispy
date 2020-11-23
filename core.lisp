;; Lispy Core
;;
;; Imported into environment before Lispy runs a file.

(begin
	(define fs (require "fs"))
	(define fs:exists (lambda (Path) (fs 'existsSync Path)))

	;; Core has its own exports
	(define exports (dict:new))

	;; ===============================================
	;; Core: configurables
	;; ===============================================
	(define ModulePrefixes ["module/" "./"])
	(define ModuleSuffixes [".lisp" ""])
	(define core:add-module-prefix (lambda (Prefix)
		(set! ModulePrefixes (cons Prefix ModulePrefixes))
		'ok
	))
	(define core:add-module-suffix (lambda (Suffix)
		(set! ModuleSuffixes (cons Suffix ModuleSuffixes))
		'ok
	))

	;; ===============================================
	;; Core: catching and errors
	;; ===============================================
	(define error:name (lambda (E) (dict:get E 'name)))
	(define error:stack (lambda (E) (dict:get E 'stack)))
	(define error:code (lambda (E) (dict:get E 'code)))
	(define catch (macro Args (cons 'lambda Args)))

	;; ===============================================
	;; Core: Module utility
	;; ===============================================
	(define import-findmodule (lambda (Name) (begin
		;; This would be done in a list comprehension, but lets try to
		;; keep core small.
		;; We're doing approximately (Erlang syntax):
		;;  [[ Pre + Name + Suf | Pre <- ModulePrefixes, Suf <- ModuleSuffices ]]
		(define Possibilities [])
		(each ModulePrefixes (lambda (P)
			(each ModuleSuffixes (lambda (S) (begin
				(define Full (+ P Name S))
				(set! Possibilities (concat Possibilities [Full]))
			)))
		))
		;; Use Array.find to get first matching existing file
		(define ExistingFile (Possibilities 'find fs:exists))
		(if (= ExistingFile undefined)
			Name
			ExistingFile)
	)))

	;; ===============================================
	;; Core: Importing and exporting
	;; ===============================================
	;; (import ModuleName)
	;; Import a Lispy module
	(define import (macro (ModuleName)
		['import-modulefile ModuleName ['env:current]]
	))

	(define ImportRequireEnv (env:current))
	;; (import-require ModuleName)
	;; Used by Lispy.Require
	(define import-require (lambda (ModuleName) (begin
		(import-modulefile ModuleName ImportRequireEnv))))

	;; Not to be called by user code
	(define import-modulefile (lambda (Path TargetEnv) (begin
		(define Contents
			(fs 'readFileSync (import-findmodule (to_s Path)) "utf8"))
		(define Parsed (parse Contents))
		(define ModuleEnv (env:new (env:toplevel TargetEnv)))
		;; Add module exports target
		(define Exports (dict:new))
		(env:define ModuleEnv 'exports Exports)
		;; Add empty argv
		(env:define ModuleEnv 'argv [])
		;; Add whatever we export from core
		(each (dict:keys exports) (lambda (Key)
			(env:define ModuleEnv Key (dict:get exports Key))))
		(define ModuleResult (eval Parsed ModuleEnv))
		;; export everything in the exports dictionary to the target env
		;; (print "Importing to current env:" (dict:keys Exports))
		(each (dict:keys Exports) (lambda (Key)
			(env:define TargetEnv Key (dict:get Exports Key))))
		;; Return all exports
		Exports
	)))

	;; (export ModuleName Function...)
	(define export (macro Args (begin
		(define ModuleName (eval (head Args) (env:current)))
		(define ModulePrefix "")
		(if (not (= "" ModuleName))
			(set! ModulePrefix (+ (to_s ModuleName) ":")))
		(define Exported (map (tail Args) (lambda (Name) (begin
			(define FullName (+ ModulePrefix (to_s Name)))
			['dict:update 'exports FullName Name]
		))))
		;; (print "Export list:" (cons 'begin Exported))
		(cons 'begin Exported)
	)))

	(define TopLevel (env:toplevel (env:current)))
	;; Exports the given functions to the top level environment
	(define export-core (macro Args (begin
		(cons 'begin (map Args (lambda (Key)
			['env:define 'TopLevel ['quote Key] Key]))))))

	;; Core: importing and exporting
	(export-core import import-require import-modulefile export)
	;; Core: try/catch and errors
	(export-core catch error:name error:stack error:code)
	;; Core: configurables
	(export-core core:add-module-prefix core:add-module-suffix)
)
