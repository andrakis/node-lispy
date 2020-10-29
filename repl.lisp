;; Lispy REPL
;; Provides an interactive shell, or read-execute-print-loop
;;
(begin
	(define ReadlineSync (require "readline-sync"))
	(define Env (env:new (env:current)))
	(define Prompt "lispy> ")

	(define get-input (lambda ()
		(js:call ReadlineSync (dict:get ReadlineSync "question") Prompt)))
	(define input-loop (lambda () (begin
		(define Input (get-input))
		(if (= Input "")
			(input-loop)
			(if (!= Input "\q") (begin
				(try
					(print (eval (parse Input) Env))
					(lambda (E) (begin
						(print "Stack:" (dict:get E "stack"))
						(print "!!" E)
					)))
				(input-loop))))
	)))

	(define usage (lambda () (begin
		(print "Welcome to Lispy REPL")
		(print "Type \q to quit")
	)))

	(usage)
	(input-loop)
)
