Lispy.js
========

A port of Lis.py to Node.js

About
=====

A special feature is that lambdas are native JavaScript functions,
with some extra properties, meaning they can be called from any
JavaScript function with no special handling. This allows easy
interoperation with all Node.js / JavaScript packages.

Next, it uses the function(...args) operator to call functions
with arbritrary parameters, rather than Object.apply which requires
a context parameter to work with many classes.

Further, any JavaScript function can be called, including those within
objects, allowing usage of any JavaScript library / module within Lispy.

The following example demonstrates this:

    (begin
        (define fs (require 'fs))
        (fs 'readFile "test.lisp" (lambda (Err Content)
            (if (not Err)
                (print Content)
                (print "Error:" Err))))
    )

The interpreter is tail recursive, and uses only a few small custom types.
Most of the engine uses native JavaScript types.

Very little error checking is done.
If it crashes, check the mistake is not in your code.

Custom types:

    Symbol            A Lisp symbol
    Environment       Lisp environment with parent support
    Lambda            A Lisp lambda, with arguments, body, and pointer to environment
    Macro             A special type of Lambda that does not immediately evaluate the
                      arguments.
    SpecialFunction   A builtin procedure that can reference the current environment.

