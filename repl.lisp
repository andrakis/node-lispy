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
	(define readline (require "readline"))
	(define fs (require "fs"))

	;; ===============================================
	;; Optional Node.js modules
	;; ===============================================
	;; Make try blocks look a bit nicer
	(define catch (macro Args (cons 'lambda Args)))
	(define try-require (lambda (Path)
		(try (require Path)
		     (catch (E) nil))))
	(define rmt (try-require "readline-matchtoken"))

	;; ===============================================
	;; Configurable options
	;; ===============================================
	(define PromptDefault      "Lispy> ")
	(define PromptContinuation "  ...> ")
	(define MaximumHistoryLines 200)
	(define HistoryFile ".repl.lisp.history")
	(define BuiltinKeywords (list "if" "quote" "define" "defined?"
		"set!" "lambda" "macro" "begin" "try"))

	;; ===============================================
	;; REPL state
	;; ===============================================
	(define ExitFlag false)
	(define ContinuationFlag false)
	(define ContinuedLine "")
	(define ShowStackFlag false)
	(define ShowParserErrorFlag false)
	(define AbortOnInterruptFlag false)
	(define DebugEvalFlag false)
	(define OriginalDebugEvalFlag (kernel:debug?))
	(define TimingFlag false)
	;; REPL environment - created with our parent as parent.
	;; This decouples the REPL state from the environment code will run in.
	(define ReplEnv (env:new (env:parent (env:current))))

	;; ===============================================
	;; REPL commands interface
	;; ===============================================
	(define Commands (dict:new))
	(define command? (lambda (Word) (dict:key? Commands Word)))
	(define command! (lambda (Word Args) ((command-body (dict:get Commands Word)) Args)))
	(define command-new  (lambda (Description Help Body) (list 'command Description Help Body)))
	(define command-desc (lambda (C) (index C 1)))     ;; ['command (Desc) Help Body]
	(define command-help (lambda (C) (index C 2)))     ;; ['command Desc (Help) Body]
	(define command-body (lambda (C) (index C 3)))     ;; ['command Desc Help (Body)]
	(define add-command  (lambda (Command Description Help Body)
		(dict:set Commands Command (command-new Description Help Body))))

	(define get-commands (lambda ()
		((dict:keys Commands) 'filter (lambda (C) (length C)))))

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
			(quit)
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

	;; \? [command...]
	(add-command '\?
		"Display help in general, or on specific command(s)"
		"Usage: \\? [command...]"
		(lambda (Args) (begin
			(print "\\? [command...]\t For help on a specific command(s)")
			(define Targets
				(if (null? Args)
					(list undefined)
					Args))
			(each (get-commands) (lambda (Key)
				(each Targets (lambda (Target)
					(if (= Target nil)
						(print Key "\t\t" (command-desc (dict:get Commands Key)))
						(if (= Target Key) (begin
							(print Key "\t\t" (command-desc (dict:get Commands Key)))
							(print "  " (command-help (dict:get Commands Key)))
						))
					)
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

	;; \p
	(add-command '\p "Toggle parser error display"
		"Toggle displaying parser errors"
		(lambda () (begin
			(set! ShowParserErrorFlag (not ShowParserErrorFlag))
			(print "Parser error display is now" (if ShowParserErrorFlag "on" "off"))
		))
	)

	;; \d [true|false]
	(add-command '\d "Toggle debug mode for evaluator"
		"\\d [true|false]    Toggle if no argument given, or enable if true is passed."
		(lambda (Args) (begin
			(if (null? Args)
				(set! DebugEvalFlag (not DebugEvalFlag))
				(set! DebugEvalFlag (truthy? (head Args))))
			(print "Debug mode is now" (if DebugEvalFlag "on" "off"))
		))
	)

	;; \t [true|false]
	(add-command '\t "Toggle timing mode for evaluator"
		"\\t [true|false]    Toggle if no argument given, or enable if true is passed."
		(lambda (Args) (begin
			(if (null? Args)
				(set! TimingFlag (not TimingFlag))
				(set! TimingFlag (truthy? (head Args))))
			(print "Timing mode is now" (if TimingFlag "on" "off"))
		))
	)

	;; Empty input does nothing
	(add-command "" "" "" (lambda () false))

	;; Command utility functions
	(define cleanup (lambda () (begin
		(write-history)
	)))
	(define quit (lambda () (begin
		(set! ExitFlag true)
		(RL 'close)
		;; History will be written to file by the closed handler above
	)))
	(define truthy? (lambda (Val)
		(if (= undefined Val)
			false
			(not (= "false" (to_s Val))))
	))

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
			(catch (E) (begin
				(set! ParseError true)
				(if ShowParserErrorFlag
					(print "Error in parsing:" (dict:get E "stack"))
				)
			))
		)
		(if ParseError
			(then-continuation Line)
			(then-run Parsed))
	)))
	(define do-eval (lambda (Code) (begin
		(define Start (date))
		(if DebugEvalFlag
			(kernel:debug true))
		(define ReplResult (eval Code ReplEnv))
		(kernel:debug OriginalDebugEvalFlag)
		(if TimingFlag
			(print "Run in" (- (date) Start) "ms"))
		ReplResult
	)))
	(define then-run (lambda (Code)
		(try
			(print (do-eval Code))
			(catch (E) (begin
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
		;; Split Input into Words, filtering empty ones
		(define Words
			((split Input " ")
			 'filter (lambda (W) (length W))))
		(define First
			(if (null? Words)
				""
				(head Words)))
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
		(RL 'on "line" execute)
		;; Line closed handler
		(RL 'on "close" cleanup)
		;; CTRL+C
		(RL 'on "SIGINT" (lambda ()
			(if ContinuationFlag
				(begin         ;; cancel continuation
					(command! '\c)
					(RL 'prompt)
				)
				(begin         ;; else
					(if AbortOnInterruptFlag
						(quit)
						(begin         ;; else
							(print "\nUse \\q to quit, or press CTRL+C again to force quit")
							(set! AbortOnInterruptFlag true)
							(RL 'prompt)
						)
					)
				)
			)
		))
		;; SIGCONT - when foreground is restored
		(RL 'on "SIGCONT" (lambda ()
			;; Resume the input
			(RL 'prompt)
		))
	)))

	;; ===============================================
	;; Tab completer
	;; ===============================================
	;; This RegExp defines all the separators available in Lispy
	(define SeparatorRegExp (regexp "( |\\(|\\[|{|\\)|\\]|})"))
	;; We can only use the callback wrapper version of the tab completer due
	;; to the way JavaScript functions report parameter counts, and readline's
	;; usage of such to determine the callback type.
	(define TabCompleter (lambda (Line) (begin
		;; Split line by separators
		(define LineSplit (Line 'split SeparatorRegExp))
		;; We match on only the last word from the line
		(define Word (last LineSplit))
		;; The rest of the line is rejoined to form the prefix
		(define LinePre (join (LineSplit 'slice 0 (- (length LineSplit) 1)) ""))
		;; Keys are: all builtins plus all environment keys
		(define Keys (concat BuiltinKeywords (env:keys ReplEnv)))
		;; Hits are: all Keys that start with our current Word
		(define Hits (Keys 'filter (lambda (C) (C 'startsWith Word))))
		;; Prepend the line prefix to all results. Funky things happen
		;; if we do not do this.
		;; return: [ [Candidate...] OriginalLine ]
		(list
			(map
				(if (null? Hits) Keys Hits)
				(lambda (H) (+ LinePre H)))
			Line)
	)))

	;; ===============================================
	;; History file management
	;; ===============================================
	(define read-history (lambda ()
		(try
			(split (fs 'readFileSync HistoryFile "utf8") "\n")
			(catch (E) (list)) ;; Return no history on error
		)
	))
	(define write-history (lambda ()
		(try
			(fs 'writeFileSync HistoryFile
				(join
					;; Only take most recent lines up to MaximumHistoryLines
					(slice (dict:get RL "history") 0 MaximumHistoryLines)
					"\n"))
			(catch (E) 'fail)
		)
	))
	(define setup-history (lambda ()
		(if (fs 'existsSync HistoryFile)
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
	(dict:update ReadlineOpts 'completer TabCompleter)
	(define RL (readline 'createInterface ReadlineOpts))
	;; Add readline-matchtoken extension if present
	(if rmt
		(rmt RL))
	(setup-handlers)
	(setup-history)

	;; Display usage and then prompt
	(command! '\usage)
	(RL 'prompt)
)

