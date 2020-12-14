;; Lispy Core
;; Loaded by: lispy.js during startup
;;
;; Imported into environment before Lispy runs a file.
;;
;; Implements modules.

(begin
	(define fs (require "fs"))
	(define fs:exists (lambda (Path) (fs 'existsSync Path)))
	(define path (require "path"))

	;; Core has its own exports
	(define exports (dict:new))

	;; ===============================================
	;; Core: configurables
	;; ===============================================
	(define ModuleSearchPaths ["" (+ (lispy:runtime) "/")])
	(define ModulePrefixes ["module/" "./"])
	(define ModuleSuffixes [".lisp" "" "/index.lisp"])
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
	(define error:name    (lambda (E) (error-lookup E 'name)))
	(define error:message (lambda (E) (error-lookup E 'message)))
	(define error:stack   (lambda (E) (error-lookup E 'stack)))
	(define error:code    (lambda (E) (error-lookup E 'code)))
	(define error-lookup  (lambda (E Member)
		(if (= 'error (typeof E))
			(dict:get E Member)
			(if (= 'string (typeof E))
				E
				"UndefinedError"))))
	(define catch (macro Args (cons 'lambda Args)))

	;; ===============================================
	;; Core: Module utility
	;; ===============================================
	;; Find the path to a module file (see ModulePrefixes, ModuleSuffixes)
	(define import-findmodule (lambda (Name) (begin
		;; This would be done in a list comprehension, but lets try to
		;; keep core small.
		;; We're doing approximately (Erlang syntax):
		;;  [[ SearchPath + Pre + Name + Suf | SearchPath <- ModuleSearchPaths,
		;;                                     Pre <- ModulePrefixes, Suf <- ModuleSuffices ]]
		(define Possibilities [])
		(each ModuleSearchPaths (lambda (SP)
			(each ModulePrefixes (lambda (P)
				(each ModuleSuffixes (lambda (S) (begin
					(define Full (path 'resolve (+ SP P Name S)))
					(set! Possibilities (concat Possibilities [Full]))
				)))
			))
		))
		;; Use Array.find to get first matching existing file
		(define ExistingFile (Possibilities 'find fs:exists))
		(if (= ExistingFile undefined)
			;; Return original name if no matching file found, so that
			;; errors will be more readable
			Name
			ExistingFile)
	)))

	;; ===============================================
	;; Core: Importing and exporting
	;; ===============================================
	;; (import ModuleName)
	;; Import a Lispy module
	(define import (macro (ModuleName)
		['import-module ['get-module ModuleName] ['env:current]]
	))

	;; Caching for import-modulefile
	(define ImportCache (dict:new))
	(define icache:get? (lambda (Key)       (dict:key? ImportCache Key)))
	(define icache:get  (lambda (Key)       (dict:get  ImportCache Key)))
	(define icache:set  (lambda (Key Value) (dict:set  ImportCache Key Value)))

	;; (get-module ModuleName::String|Atom)
	(define get-module (lambda (Path) (begin
		(define FullPath (import-findmodule (to_s Path)))
		;; (print "Object in cache for" FullPath ":" (inspect (icache:get FullPath)))
		(if (icache:get? FullPath)
			(icache:get FullPath)
			(begin
				(define Module (module-evaluate (fs 'readFileSync FullPath "utf8")))
				(icache:set FullPath Module)
				Module)))))

	(define TopLevel (env:toplevel (env:current)))
	(define module-evaluate (lambda (Content) (begin
		(define Parsed (parse Content))
		(define ModuleEnv (env:new TopLevel))
		;; Add module exports target
		(define Exports (dict:new))
		(env:define ModuleEnv 'exports Exports)
		;; Add empty argv
		(env:define ModuleEnv 'argv [])
		;; Add whatever we export from core
		(each (dict:keys exports) (lambda (Key)
			(env:define ModuleEnv Key (dict:get exports Key))))
		(eval Parsed ModuleEnv)
		Exports)))

	;; Perform the import of a module's exports object to the target environment.
	(define import-module (lambda (Exports TargetEnv) (begin
		;; export everything in the exports dictionary to the target env
		(each (dict:keys Exports) (lambda (Key)
			(env:define TargetEnv Key (dict:get Exports Key))))
		;; Return all exports
		Exports
	)))

	;; (export ModuleName Function...)
	(define export (macro Args (begin
		(define ModuleName (eval (head Args) (env:current)))
		(define ModulePrefix
			(if (= "" ModuleName)
				""
				(+ (to_s ModuleName) ":")))
		(define Exported (map (tail Args) (lambda (Name) (begin
			(define FullName (+ ModulePrefix (to_s Name)))
			['dict:update 'exports FullName Name]
		))))
		;; (print "Export list:" (cons 'begin Exported))
		(cons 'begin Exported)
	)))

	(define export-toplevel (lambda (Members)
		(each (dict:keys Members) (lambda (Key)
			(env:define TopLevel Key (dict:get Members Key))))))

	;; Exports the given functions to the top level environment
	(define export-core (macro Args (begin
		(cons 'begin (map Args (lambda (Key)
			['env:define 'TopLevel ['quote Key] Key]))))))

	;; Core: importing and exporting
	(export-core import import-module get-module export)
	;; Core: try/catch and errors
	(export-core catch error:name error:message error:stack error:code)
	;; Core: configurables
	(export-core core:add-module-prefix core:add-module-suffix export-toplevel)


	;; ===============================================
	;; Core: Global flags
	;; ===============================================
	(define Flags (dict:new))
	(define lispy:flag? (lambda (Name) (dict:key? Flags Name)))
	(define lispy:flag  (lambda (Name)
		(if (lispy:flag? Name)
			(dict:get Flags Name)
			false
		)
	))
	(define lispy:flag! (lambda (Name Value) (dict:set Flags Name Value)))

	(export-core lispy:flag? lispy:flag! lispy:flag)
)
