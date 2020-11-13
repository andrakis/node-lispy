;; Lispy REPL
;; Provides an interactive shell, or read-execute-print-loop.
;;
;; If the code entered does not parse correctly, you are prompted for the
;; rest of the line via a "...>" prompt. You can cancel this by typing \c
;; or pressing CTRL+C.
;;
;; History is saved to the file: .repl.lisp.history
;; A maximum of 200 lines are saved to the file.
;;
(begin
	;; ===============================================
	;; Required Node.js modules
	;; ===============================================
	(define Readline (require "readline"))
	(define FS (require "fs"))

	;; ===============================================
	;; Configurable options
	;; ===============================================
	(define PromptDefault      "Lispy> ")
	(define PromptContinuation "  ...> ")
	(define MaximumHistoryLines 200)
	(define HistoryFile ".repl.lisp.history")

	;; ===============================================
	;; REPL state
	;; ===============================================
	(define ExitFlag false)
	(define ContinuationFlag false)
	(define ContinuedLine "")
	(define ShowStackFlag false)
	(define AbortOnInterruptFlag false)
	(define Env (env:new (env:parent (env:current)))) ;; REPL environment

	;; ===============================================
	;; REPL commands interface
	;; ===============================================
	(define Commands (dict:new))
	(define command? (lambda (Word) (dict:key? Commands Word)))
	(define command! (lambda (Word Args) ((command-body (dict:get Commands Word)) Args)))
	(define command-new  (lambda (Description Help Body) (list 'command Description Help Body)))
	(define command-desc (lambda (C) (head (tail C)))) ;; ['command (Desc) Help Body]
	(define command-help (lambda (C) (head (tail (tail C))))) ;; ['command Desc (Help) Body]
	(define command-body (lambda (C) (head (tail (tail (tail C)))))) ;; ['command Desc Help (Body)]
	(define add-command (lambda (Command Description Help Body)
		(dict:set Commands Command (command-new Description Help Body))))

	;; ===============================================
	;; REPL commands
	;; ===============================================

	;; \usage
	(add-command '\usage
		"Display usage of REPL"
		""
		(lambda () (begin
			(print "Welcome to Lispy REPL")
			(print "Type \\q to quit, \\? for commands")
		))
	)

	;; \q
	(add-command '\q
		"Quit the REPL"
		""
		(lambda () (begin
			(set! ExitFlag true)
			;; Save history to file
			(write-history)
			(RL 'close)
		))
	)

	;; \c
	(add-command '\c
		"Cancel current line input or continuation"
		"When a parser error occurs, the continuation prompt is shown. This cancels a continuation and starts with a fresh line."
		(lambda () (begin
			(set! ContinuationFlag false)
			(RL 'setPrompt PromptDefault)
		))
	)

	;; \? [command]
	(add-command '\?
		"Display help in general, or on specific command"
		"Usage: \\? [command]"
		(lambda (Args) (begin
			(print "\\? [command]\t For help on a specific command")
			(define Target nil)
			(if (> (length Args) 0)
				(set! Target (head Args)))
			(each (dict:keys Commands) (lambda (Key)
				(if (not (= Key "")) (begin
					(if (= Target nil)
						(print Key "\t\t" (command-desc (dict:get Commands Key))))
					(if (= Target Key) (begin
						(print Key "\t\t" (command-desc (dict:get Commands Key)))
						(print "  " (command-help (dict:get Commands Key)))
					))
				))
			))
		))
	)

	;; \s
	(add-command '\s "Toggle stack tracing"
		"Toggle JavaScript stack tracing when an exception is thrown"
		(lambda () (begin
			(set! ShowStackFlag (not ShowStackFlag))
			(print "Stack tracing is now" (if ShowStackFlag "on" "off"))
		))
	)
	;; Empty input does nothing
	(add-command "" "" (lambda () false))

	;; ===============================================
	;; REPL internal
	;; ===============================================
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
		(if ParseError
			(then-continuation Line)
			(then-run Parsed))
	)))
	(define then-run (lambda (Code)
		(try
			(print (eval Code Env))
			(lambda (E) (begin
				(define EName (dict:get E 'name))
				(if ShowStackFlag 
					(print (dict:get E 'stack))
					(print (dict:get E 'message))
				)
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

	(define setup-handlers (lambda () (begin
		;; Line input handler
		(RL 'on "line" (lambda (Input) (begin
			(execute Input)
		)))
		;; CTRL+C
		(RL 'on "SIGINT" (lambda ()
			(if ContinuationFlag
				(begin         ;; cancel continuation
					(command! '\c)
					(RL 'prompt)
				)
				(begin         ;; else
					(if AbortOnInterruptFlag
						(command! '\q) ;; quit
						(begin         ;; else
							(print "\nUse \\q to quit, or press CTRL+C again to force quit")
							(set! AbortOnInterruptFlag true)
							(RL 'prompt)
						)
					)
				)
			)
		))
	)))

	;; ===============================================
	;; History file management
	;; ===============================================
	(define read-history (lambda ()
		(split (FS 'readFileSync HistoryFile "utf8") "\n")))
	(define write-history (lambda ()
		(try
			(FS 'writeFileSync HistoryFile
				(join
					;; Only take most recent lines up to MaximumHistoryLines
					(slice (dict:get RL "history") 0 MaximumHistoryLines)
					"\n"))
			;; catch
			(lambda (E) nil) ;; ignored
		)
	))
	(define setup-history (lambda ()
		(if (FS 'existsSync HistoryFile)
			(dict:set RL "history" (read-history))
		)
	))

	;; ===============================================
	;; REPL startup
	;; ===============================================
	(define ReadlineOpts (dict:new))
	(dict:update ReadlineOpts 'input (stdin))
	(dict:update ReadlineOpts 'output (stdout))
	(dict:update ReadlineOpts 'prompt PromptDefault)
	(define RL ((dict:get Readline 'createInterface) ReadlineOpts))
	(setup-handlers)
	(setup-history)

	;; Display usage and then prompt
	(command! '\usage)
	(RL 'prompt)
)

