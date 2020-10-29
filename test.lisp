;; A sample file testing a few features, including reading a file
(begin
	(print "Hello, world!")
	(define add (lambda (X Y) (+ X Y)))
	(define A 5)
	(define B 10)
	(print A "+" B "=" (add A B))
	(define fac1 (lambda (N)
		(if (<= N 1)
			1
			(* N (fac1 (- N 1)))
		)
	))
	(define fac2 (lambda (N) (fac2a N 1)))
	(define fac2a (lambda (N A)
		(if (<= N 1)
			A
			(fac2a (- N 1) (* N A))
		)
	))
	(print "Fac1" B "=" (fac1 B))
	(print "Fac2" B "=" (fac2 B))
	(define FS (require "fs"))
	(print "Size of lispy.js:"
		(length (to_s (js:call FS (dict:get FS "readFileSync") "lispy.js"))))
)

