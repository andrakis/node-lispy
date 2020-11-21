Lispy.js
========

A port of Lis.py to Node.js

Why?
----

Intended to be very small, lightweight, and barebones, but able to interface
with all Node.js packages thus giving it much power.

In terms of being lightweight, it does not implement it's own Read-Execute-Print-Loop (REPL),
instead implementing the REPL in [repl.lisp](https://github.com/andrakis/node-lispy/blob/main/repl.lisp).

It is also able to run itself: see the [dynamic evaluator](https://github.com/andrakis/node-lispy/blob/main/dyneval.lisp) for
an example on interpreting Lispy, written in Lispy.

Usage
-----

From the command line:

    node index.js [file-to-run.lisp]

From a Node.js module:

    var Lispy  = require('lispy');
    var Code   = Lispy.Parse('(print "Hello, world!")');
    var Result = Lispy.Eval(Code, Lispy.StandardEnvironment);

About
-----

A special feature is that lambdas are native JavaScript functions,
with some extra properties, meaning they can be called from any
JavaScript function with no special handling. This allows easy
interoperation with all Node.js / JavaScript packages.

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
    Tuple             A special type of list.
