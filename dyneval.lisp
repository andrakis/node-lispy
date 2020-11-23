;; Dynamic Evaluator for Lispy
;;
;; Implements an extendable evaluator.
;; No parser implemented here.
;;
;; Usage:
;; node index.lisp -- dyneval.lisp [-d] [-t] [-N] [-E] [--] [filename.lisp] [arguments...]
;;     -d                Enable debug mode
;;     -t                Enable timing mode
;;     -T                Enable test mode
;;     -N                Enable nested evaluator mode
;;     -E                Attach dyneval to created lambas for evaluation
;;     --                Stop argument passing
;;     filename.lisp     File to run
;;     arguments...      Arguments to pass to file

(begin
	(define GlobalStartup (date))

	(import 'jumptable)
	(import 'fs)

	;; If the -E flag is passed, points to dyneval
	(define TargetEvaluator undefined)

	;; ===============================================
	;; Debugging
	;; ===============================================
	(define reporter-non-debug (lambda () nil))
	(define reporter-debug (lambda Args (proc:apply print (cons (debug-str) Args))))
	(define inspector-non-debug (lambda () nil))
	(define inspector-debug (lambda (Val)
		((to_string Val true) 'substr 0 DebugMaxLength)))
	(define debug-str (lambda ()
		(+ (if (< DebugDepth 20)
				("-" 'repeat DebugDepth)
				(+ "-                " DebugDepth " | "))
			" dyneval"
		)))

	(define DebugDepth 1)
	(define DebugMaxLength 100)
	(define DebugReporter reporter-non-debug)
	(define DebugInspector inspector-non-debug)
	(define DebugEvaluator nil) ;; filled in later
	(define debug! (lambda (val) (begin
		(set! DebugReporter (if val reporter-debug reporter-non-debug))
		(set! DebugInspector (if val inspector-debug inspector-non-debug))
		(set! DebugEvaluator (if val dyneval-loop-debug dyneval-loop-normal))
		(set! DebugMode val)
		(debug?)
	)))
	(define debug? (lambda () (= DebugReporter reporter-debug)))
	(define DebugMode (debug?))

	;; ===============================================
	;; Evaluator implementation
	;; ===============================================

	;; ------------------------
	;; Top level evaluator.
	;;   'symbol 'list
	;; Anything else is returned immediately
	(define SimpleTable (jumptable:new))
	;;   o If symbol, lookup the symbol in the environment
	(jumptable:update SimpleTable 'symbol    (lambda (X Env) {'ok (env:get Env X)}))
	;;   o Lists are function calls - dispatch to the BuiltinTable
	(jumptable:update SimpleTable 'list      (lambda (X Env)
		((jumptable:get BuiltinTable (head X)) X Env)))
	;;   o Everything else is returned immediately
	(jumptable:update SimpleTable     _      (lambda (X) {'ok X}))

	;; ===============================================
	;; Builtins
	;; ===============================================
	(define BuiltinTable (jumptable:new))
	;;   o (if Cond Condeq Alt)
	(jumptable:update BuiltinTable 'if       (lambda (X Env)
		;; tail recurse with result
		{'continue
			(if (dyneval (index X 1) Env)
				(index X 2)
				(if (> (length X) 3) (index X 3) nil))
		Env}
	))
	;;   o (quote Exp)
	(jumptable:update BuiltinTable 'quote    (lambda (Args Env) {'ok (index Args 1)}))
	;;   o (define Name Value)
	(jumptable:update BuiltinTable 'define   (lambda (Args Env)
		{'ok (env:define Env (index Args 1) (dyneval (index Args 2) Env))}))
	;;   o (defined? Name)
	(jumptable:update BuiltinTable 'defined? (lambda (Args Env)
		{'ok (env:defined? Env (index Args 1))}))
	;;   o (set! Name Value)
	(jumptable:update BuiltinTable 'set!     (lambda (Args Env)
		{'ok (env:set! Env (index Args 1)   (dyneval (index Args 2) Env))}))
	;;   o (lambda Args Body)
	(jumptable:update BuiltinTable 'lambda   (lambda (Args Env)
		{'ok (lambda:new (index Args 1) (index Args 2) Env TargetEvaluator)}))
	;;   o (macro Args Body)
	(jumptable:update BuiltinTable 'macro    (lambda (Args Env)
		{'ok (macro:new (index Args 1) (index Args 2) Env)}))
	;;   o (begin Exps...)
	(jumptable:update BuiltinTable 'begin    (lambda (Args Env) (dyneval-begin (tail Args) Env)))
	;;   o (try Expression Catcher)
	(jumptable:update BuiltinTable 'try      (lambda (X Env)
		(try
			{'ok (dyneval (index X 1) Env)}
			(catch (E) (begin
				(define Handler (dyneval (index X 2) Env))
				(if (= (typeof Handler) 'lambda)
					(begin
						(define Env2 (env:new (lambda:env Handler)))
						(env:update Env2 (lambda:args Handler) [E])
						;; tail recurse
						{'continue (lambda:body Handler) Env2}
					)
					{'ok (Handler E) Env}
				)
			))
		)
	))
	;;   o Not a builtin, dispatch to ProcTypeTable1
	(jumptable:update BuiltinTable     _     (lambda (Args Env) (begin
		(define Proc (dyneval (head Args) Env))
		((jumptable:get ProcTypeTable1 (typeof Proc)) Proc (tail Args) Env))))
	;;   o Helper for begin
	(define dyneval-begin (lambda (X Env)
		;; if one item left...
		(if (null? (tail X))
			;; tail recurse
			{'continue (head X) Env}
			;; evaluate without keeping result by passing it as an argument
			;; that is not captured.
			(dyneval-begin (tail X) Env (dyneval (head X) Env)))))

	;; ===============================================
	;; Non-builtin dispatch
	;; ===============================================

	;; ------------------------
	;; Dispatch stage 1:
	;; ------------------------
	(define ProcTypeTable1 (jumptable:new))
	;;  o Dispatcher helper to ProcTable2
	(define dyneval-dispatch (lambda (Proc Exps Env)
		((jumptable:get ProcTypeTable2 (typeof Proc)) Proc Exps Env)))
	;;  o If macro, skip to dyneval-dispatch
	(jumptable:update ProcTypeTable1 'macro    dyneval-dispatch)
	;;  o Otherwise, evaluate and collect all arguments
	(jumptable:update ProcTypeTable1     _     (lambda (Proc Exps Env)
		(dyneval-dispatch
			Proc
			(map Exps (lambda (E) (dyneval E Env)))
			Env)))

	;; ------------------------
	;; Dispatch stage 2:
	;;  'lambda 'macro 'proc 'sproc 'object
	;; ------------------------
	(define ProcTypeTable2 (jumptable:new))
	;;  o If lambda, setup new environment and recurse with
	;;    lambda body and new environment.
	(jumptable:update ProcTypeTable2 'lambda (lambda (Proc Exps Env) (begin
		(define Env2 (env:new (lambda:env Proc)))
		(env:update Env2 (lambda:args Proc) Exps)
		;; tail recurse
		{'continue (lambda:body Proc) Env2})))
	;;  o If macro, setup new environment, evaluate in new
	;;    environment, then run the result in the previous
	;;    environment.
	(jumptable:update ProcTypeTable2 'macro (lambda (Proc Exps Env) (begin
		(define Env2 (env:new (macro:env Proc)))
		(env:update Env2 (macro:args Proc) Exps)
		(define Result (dyneval (macro:body Proc) Env2))
		;; tail recurse
		{'continue Result Env})))
	;;  o If proc, use apply to call the proc
	(jumptable:update ProcTypeTable2 'proc (lambda (Proc Exps Env)
		{'ok (proc:apply Proc Exps)}))
	;;  o If sproc, call directly with Exps and environment
	(jumptable:update ProcTypeTable2 'sproc (lambda (Proc Exps Env)
		{'ok (Proc Exps Env)}))
	;;  o If object, use objectapply to do the equivalent of:
	;;    Object[Member](...Exps)
	(jumptable:update ProcTypeTable2 _      (lambda (Proc Exps Env)
		{'ok (proc:objectapply Proc (head Exps) (tail Exps))}))

	;; ===============================================
	;; Main execution loop
	;; ===============================================

	;; ------------------------
	;; Loop handlers
	;;  'continue 'ok
	;; ------------------------
	(define LoopResultTable (jumptable:new))
	;;   o For 'continue, tail recurse into dyneval-loop using
	;;     the provided body and environment.
	(jumptable:update LoopResultTable 'continue (lambda (X)
		(DebugEvaluator (index X 1) (index X 2))))
	;;   o For 'ok, return the result
	(jumptable:update LoopResultTable 'ok (lambda (X) (index X 1)))

	;;   o Dispatcher with debug output capabilities
	;;     o Dispatches to SimpleTable
	;;     o Tail recurses to LoopResultTable
	(define dyneval-loop-debug (lambda (X Env) (begin
		(DebugReporter (DebugInspector X))
		(define Result ((jumptable:get SimpleTable (typeof X)) X Env))
		(DebugReporter (DebugInspector X) "=>" (DebugInspector Result))
		((jumptable:get LoopResultTable (head Result)) Result))))
	(define dyneval-loop-normal (lambda (X Env) (begin
		(define Result ((jumptable:get SimpleTable (typeof X)) X Env))
		((jumptable:get LoopResultTable (head Result)) Result))))

	;; ------------------------
	;; Main evaluator function
	;; ------------------------
	(define dyneval (lambda (X Env) (begin
		(set! DebugDepth (+ DebugDepth 1))
		(define Result (DebugEvaluator X Env))
		(set! DebugDepth (- DebugDepth 1))
		Result
	)))

	;; ===============================================
	;; Extension support
	;;
	;; All extension handlers must return a Tuple in the forms:
	;;  {'ok ReturnValue}
	;;    o Returns ReturnValue immediately
	;;  {'continue Body Environment}
	;;    o Tail recurse with Body using Environment
	;; ===============================================

	;;   o Use to add top-level evaluator handling.
	;;   o Type is that obtained from: (typeof Value)
	;;   o Handler receives: (Val Env)
	(define add-simple-handler (lambda (Type Handler) (begin
		(jumptable:update SimpleTable Type Handler)
		{'ok}
	)))

	;;   o Use to add builtins.
	;;   o Handler receives: (Call Environment)
	;;     o Call is the full call to the builtin, including
	;;       the builtin name and all arguments.
	;;     o Env is the executing environment.
	(define add-builtin (lambda (Symbol Handler) (begin
		(jumptable:update BuiltinTable Symbol Handler)
		{'ok}
	)))

	;;   o Use to add support for callables, before arguments
	;;     have been evaluated.
	;;   o Type is that obtained from (Typeof Val)
	;;   o Handler recives: (Proc Exps Env)
	;;     o Proc is the callable item
	;;     o Exps are the non-evaulated arguments
	;;     o Env is the executing environment
	(define add-proc-handler1 (lambda (Type Handler) (begin
		(jumptable:update ProcTable1 Type Handler)
		{'ok}
	)))

	;;   o Use to add support for callables, after arguments
	;;     have been evaluated.
	;;   o Type is that obtained from (Typeof Val)
	;;   o Handler recives: (Proc Exps Env)
	;;     o Proc is the callable item
	;;     o Exps are the evaulated arguments
	;;     o Env is the executing environment
	(define add-proc-handler2 (lambda (Type Handler) (begin
		(jumptable:update ProcTable2 Type Handler)
		{'ok}
	)))

	;; ===============================================
	;; Testing
	;; ===============================================
	(define test (lambda () (begin
		(define Successes 0)
		(define Failures 0)

		;; Help macro: increment an integer variable
		(define inc! (macro (Name Value) (begin
			(if (= undefined Value)
				(set! Value 1))
			['set! Name ['+ Name Value]])))

		;; TODO: perform in try block?
		(define ?testeq (macro (Cond Eq)
			['begin
				['define 'Condeq Cond]
				['if ['= 'Condeq Eq]
					['begin
						['inc! 'Successes]
						'true
					]
					['begin
						['print "Test failed:" ['quote Cond] "should be =" Eq ", is actually =" 'Condeq]
						['inc! 'Failures]
						'false]
				]
			]
		))

		;; Test environment
		(define Env (env:new (env:current)))
		(env:define Env 'test-key 'test-value)

		;; Tests
		(print "---- Begin simple tests")
			(?testeq (dyneval nil Env) nil)
			(?testeq (dyneval 'undefined Env) undefined)
			(?testeq (dyneval 1 Env) 1)
			(?testeq (dyneval "test" Env) "test")
			(?testeq (dyneval 'test-key Env) 'test-value)
			(?testeq (dyneval (parse "(begin (define add (lambda (A B) (+ A B))) (add 3 2))") Env) 5)
		(print "---- Begin test.lisp")
		(?testeq (dyneval (parse (fs:readFile "test.lisp" "utf8")) Env) 'ok)
		(print "---- Done")
		(print "Successes:" Successes ", failures:" Failures)
		{(if Failures 'failure 'ok) Successes Failures}
	)))

	;; ===============================================
	;; Command line parsing.
	;; Of course, uses jumptables.
	;; ===============================================
	(define get-opts:OptsTable (jumptable:new))
	(jumptable:update get-opts:OptsTable '-h (lambda (Opts Argv)
		(get-opts:get-next-opt
			(dict:update Opts 'HelpFlag true)
			(tail Argv))))
	(jumptable:update get-opts:OptsTable '-d (lambda (Opts Argv)
		(get-opts:get-next-opt
			(dict:update Opts 'DebugFlag true)
			(tail Argv))))
	(jumptable:update get-opts:OptsTable '-t (lambda (Opts Argv)
		(get-opts:get-next-opt
			(dict:update Opts 'TimingFlag true)
			(tail Argv))))
	(jumptable:update get-opts:OptsTable '-T (lambda (Opts Argv)
		(get-opts:get-next-opt
			(dict:update Opts 'TestFlag true)
			(tail Argv))))
	(jumptable:update get-opts:OptsTable '-N (lambda (Opts Argv)
		(get-opts:get-next-opt
			(dict:update Opts 'NestedFlag true)
			(tail Argv))))
	(jumptable:update get-opts:OptsTable '-E (lambda (Opts Argv)
		(get-opts:get-next-opt
			(dict:update Opts 'DynEvalFlag true)
			(tail Argv))))
	(jumptable:update get-opts:OptsTable '-- (lambda (Opts Argv)
		(get-opts:get-next-opt
			(dict:update Opts 'AcceptingFlags false)
			(tail Argv))))
	(jumptable:update get-opts:OptsTable _   (lambda (Opts Argv)
		(if (= undefined (dict:get Opts 'Filename))
			(get-opts:get-next-opt
				(dict:update Opts 'Filename (head Argv))
				(tail Argv))
			(get-opts:get-next-opt
					(dict:update Opts 'Arguments
						(concat (dict:get Opts 'Arguments) (head Argv)))
					(tail Argv)))))
	(define get-opts:get-next-opt (lambda (Opts Argv)
		(if (null? Argv)
			Opts
			((jumptable:get get-opts:OptsTable
				(if (dict:get Opts 'AcceptingFlags)
					(head Argv)
					_
				))
			Opts Argv)
		)
	))
	(define get-opts (lambda () (begin
		(define Opts (dict:new))
		(dict:update Opts 'Filename undefined)
		(dict:update Opts 'HelpFlag false)
		(dict:update Opts 'DebugFlag false)
		(dict:update Opts 'TimingFlag false)
		(dict:update Opts 'TestFlag false)
		(dict:update Opts 'NestedFlag false)
		(dict:update Opts 'DynEvalFlag false)
		(dict:update Opts 'Arguments [])
		(dict:update Opts 'AcceptingFlags true)
		(get-opts:get-next-opt Opts argv)
	)))

	(define show-help (lambda () (begin
		(print "Usage:")
		(print "node index.lisp -- dyneval.lisp [-d] [-t] [-N] [--] [filename.lisp] [arguments...]")
		(print "     -d                Enable debug mode")
		(print "     -t                Enable timing mode")
		(print "     -T                Enable test mode")
		(print "     -N                Enable nested evaluator mode")
		(print "     -E                Attach dyneval to created lambas for evaluation")
		(print "     --                Stop argument passing")
		(print "     filename.lisp     File to run")
		(print "     arguments...      Arguments to pass to file")
	)))

	;; ===============================================
	;; Entry point
	;; ===============================================
	(define main (lambda () (begin
		(define ArgOpts (get-opts))
		(if (dict:get ArgOpts 'TestFlag)
			(test)
			(if (or (dict:get ArgOpts 'HelpFlag) (= undefined (dict:get ArgOpts 'Filename)))
				(show-help)
				(begin
					(define TimingFlag (dict:get ArgOpts 'TimingFlag))
					(debug! (dict:get ArgOpts 'DebugFlag))
					(define TargetEnv (env:new (env:current)))
					;; Set the argv in the target environment
					(env:define TargetEnv 'argv (dict:get ArgOpts 'Arguments))
					(if (dict:get ArgOpts 'NestedFlag) (begin
						;; Update eval to point to our evaluator
						(env:set! TargetEnv 'eval dyneval)
						;; Add ourself
						(env:define TargetEnv 'dyneval exports)
					))
					(if (dict:get ArgOpts 'DynEvalFlag)
						(set! TargetEvaluator dyneval))
					;; Set a dummy exports
					(env:define TargetEnv 'exports (dict:new))
					;; Set __main__
					(env:define TargetEnv '__main__ true)
					(if (dict:get ArgOpts 'TimingFlag) (print "Global startup in" (+ (- (date) GlobalStartup) "ms")))
					(try
						(begin
							(define Start (date))
							(define Parsed (parse
								(fs:readFile (dict:get ArgOpts 'Filename) "utf8")))
							(define End (date))
							(if TimingFlag (print "Parsed in" (+ (- End Start) "ms")))
							(set! Start (date))
							(define Result (dyneval Parsed TargetEnv))
							(set! End (date))
							(if TimingFlag (print "Run in" (+ (- End Start) "ms")))
							Result
						)
						(catch (E)
							(print "Error:" (dict:get E 'stack)))
					)
				)
			)
		)
	)))

	(export 'dyneval
		dyneval
		debug!
		debug?
		add-simple-handler
		add-builtin
		add-proc-handler1
		add-proc-handler2
		test)

	(debug! false)
	(if (defined? __main__)
		(main)
	)
)
