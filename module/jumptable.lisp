;; ===============================================
;; Module: Jumptable
;; Related: jumptable.js
;;
;; A jumptable allows simple pattern matching and lookup.
;;
;; For now, they're just dictionaries.
;; Every key points to a function that will handle the next
;; stage of evaluation. Think of it like a state machine.
;; ===============================================
(begin
	;; _ is used to denote no match
	(define _    "_")

	;;(lispy:flag! 'pure true)
	(if (lispy:flag 'pure)
		(begin
			(define new    (lambda () (dict:new)))
			(define update (lambda Args
				(proc:apply dict:update Args)))
			(define set    (lambda (Table Key Value)
				(dict:set Table Key Value)))
			(define key    (lambda (Table Key)
				(if (dict:key? Table (to_s Key))
					Key
					_
				)
			))
			(define get (lambda (Table Key)
				(dict:get Table (key Table (to_s Key)))))
		)

		;; else
		(begin
			(define jt  (require "./module/jumptable"))
			(define _   (dict:get jt '_))
			(define new (dict:get jt 'new))
			(define update
			            (dict:get jt 'update))
			(define set (dict:get jt 'set))
			(define key (dict:get jt 'key))
			(define get (dict:get jt 'get))
		)
	)

	(export 'jumptable new update set key get)

	;; exports _ to global namespace
	(export "" _)
)
