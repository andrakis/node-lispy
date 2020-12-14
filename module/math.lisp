;; ===============================================
;; Module: math
;;
;; Various math functions from the JavaScript Math object
;; ===============================================

(begin

	(define Math (lispy:jseval "Math"))
	(define MathFunctions [
		'E 'LN10 'LN2 'LOG10E 'LOG2E
		'PI 'SQRT1_2 'SQRT2
		'abs 'acos 'acosh 'asin 'asinh
		'atan 'atan2 'atanh
		'cbrt 'ceil 'clz32 'cos
		'cosh 'exp 'expm1 'floor
		'fround 'hypot 'imul 'log
		'log10 'log1p 'log2 'max
		'min 'pow 'random 'round
		'sign 'sin 'sinh 'sqrt
		'tan 'tanh 'trunc
	])

	(define ModuleEnv (env:current))
	(each MathFunctions (lambda (Name) (begin
		(env:define ModuleEnv Name (dict:get Math Name)))))
	(define export-many (macro (ModuleName FunctionNames)
		(concat ['export ModuleName] (eval FunctionNames (env:current)))))
	(export-many 'math MathFunctions)
)

