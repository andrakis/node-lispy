;; ===============================================
;; Module: fs
;;
;; A nicer interface to the NodeJS filesystem module.
;; ===============================================

(begin
	(define fs (require "fs"))

	(define exists (lambda (Path) (fs 'existsSync Path)))
	(define readFile (lambda (Path Options) (fs 'readFileSync Path Options)))
	(define writeFile (lambda (File Data Options) (fs 'writeFileSync File Data Options)))

	(export 'fs
		exists
		readFile
		writeFile)
)
