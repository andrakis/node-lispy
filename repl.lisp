;; Lispy REPL
;; Provides an interactive shell, or read-execute-print-loop.
;;
;; If the code entered does not parse correctly, you are prompted for the
;; rest of the line via a "...>" prompt. You can cancel this by typing \c
;;
(begin
	(define Env (env:new (env:parent (env:current))))
	(define Readline (require "readline"))

	(define PromptDefault "Lispy> ")
	(define PromptContinuation "  ...> ")
	(define Commands (dict:new))
	(define ExitFlag false)
	(define ContinuationFlag false)
	(define ContinuedLine "")

	(define command? (lambda (Word) (dict:key? Commands Word)))
	(define command! (lambda (Word Args) ((command-body (dict:get Commands Word)) Args)))
	(define command-new  (lambda (Description Body) (list 'command Description Body)))
	(define command-desc (lambda (C) (head (tail C)))) ;; ['command (Description) Body]
	(define command-body (lambda (C) (head (tail (tail C))))) ;; ['command Description (Body)]

	(define add-command (lambda (Command Description Body)
		(dict:set Commands Command (command-new Description Body))))

	;; REPL commands
	(add-command 'usage "Display usage of REPL" (lambda () (begin
		(print "Welcome to Lispy REPL")
		(print "Type \\q to quit, \\? for commands")
	)))
	(add-command '\q "Quit the REPL" (lambda () (begin
		(set! ExitFlag true)
		(RL 'close)
	)))
	(add-command '\c "Cancel current line input or continuation" (lambda () (begin
		(set! ContinuationFlag false)
		(RL 'setPrompt PromptDefault)
	)))
	(add-command '\? "Display help in general, or on specific command" (lambda (Args) (begin
		(define Target nil)
		(if (> (length Args) 0)
			(set! Target (head Args)))
		(map (dict:keys Commands) (lambda (Key)
			(if (and (not (= Key "")) (or (= Target Key) (= Target nil)))
				(print Key "\t\t" (command-desc (dict:get Commands Key))))
		))
	)))
	;; Empty input does nothing
	(add-command "" "" (lambda () false))

	;; REPL internal
	(define parse-then-run (lambda (Line) (begin
		(if ContinuationFlag (begin
			(set! ContinuationFlag false)
			(set! Line (+ ContinuedLine Line))
			(RL 'setPrompt PromptDefault)
		))
			
		(define ParseError false)
		(define Parsed "")
		(try
			(set! Parsed (parse Line))
			(lambda (E) (begin
				;;(print "Error in parsing:" (dict:get E "stack"))
				(set! ParseError true)
			))
		)
		(if (not ParseError)
			(then-run Parsed)
			(then-continuation Line))
	)))
	(define then-run (lambda (Code)
		(try
			(print (eval Code Env))
			(lambda (E) (begin
				(define EName (dict:get E 'name))
				(print (dict:get E 'message))
			))
		)
	))
	(define then-continuation (lambda (Input) (begin
		(set! ContinuationFlag true)
		(set! ContinuedLine Input)
		(RL 'setPrompt PromptContinuation)
	)))

	(define execute (lambda (Input) (begin
		(define Words (split Input " "))
		(define First (head Words))
		(if (command? First)
			(command! First (tail Words))
			(parse-then-run Input)
		)
		(if (not ExitFlag)
			(RL 'prompt)
		)
	)))

	;; REPL startup
	(define ReadlineOpts (dict:new))
	(dict:update ReadlineOpts 'input (stdin))
	(dict:update ReadlineOpts 'output (stdout))
	(dict:update ReadlineOpts 'prompt PromptDefault)
	(define RL ((dict:get Readline 'createInterface) ReadlineOpts))
	(RL 'on "line" (lambda (Input) (begin
		(execute Input)
	)))

	;; Display usage and then prompt
	(command! 'usage)
	(RL 'prompt)
)

