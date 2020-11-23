Lispy.js
========

A port of Lis.py to Node.js


Why?
----

Intended to be very small, lightweight, and barebones, but able to interface
with all Node.js packages thus giving it much power.

It is also possible to use any Lispy module as a NodeJS module. Any exported functions will
be returned in a call to <code>Require</code>, and can be called directly.

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
    // You can import Lispy modules and use them as NodeJS modules
    var DynEval= Lispy.Require("dyneval");
    // You can also call module functions directly
    DynEval.dyneval(Code);
    // For function names that are not directly compatible with JavaScript:
    DynEval['debug!'](true);


About
-----

A special feature is that lambdas are native JavaScript functions,
with some extra properties, meaning they can be called from any
JavaScript function with no special handling. This allows easy
interoperation with all Node.js / JavaScript packages, as well as
the ability to use Lispy modules directly from JavaScript.

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


Modules
-------

Lispy has a module system. It is currently in early development.

Any Lispy module may be imported in Lispy code via:

    (import ModuleName)  ;; ModuleName can be a symbol, and does not require .lisp
    (import 'fs)

Modules must export functions via the <code>(export ModuleName Function...)</code> method:

    (export 'dyneval debug! debug?)  ;; Makes dyneval:debug! and dyneval:debug? available

Modules are run in their own environment, and do not pollute higher environment spaces.
They import only the specified export members into the callers environment.

Modules have two search paths, the prefixes, and the suffixes. By default these are:

    (define ModulePrefixes ["module/" "./"])
    (define ModuleSuffixes [".lisp" ""])

Modules will first be searched for in the <code>modules</code> directory, then the current
directory. Providing a full direct path also works.

New prefixes and suffixes may also be added to the head of the lists by way of the
<code>(core:add-module-prefix Prefix)</code> and <code>(core:add-module-suffix)</code> functions.
These can also be manipulated from NodeJS by using the <code>CoreEnvironment['core:add-module-prefix']</code> and <code>CoreEnvironment['core:add-module-suffix']</code> functions.

Custom types
------------

Where possible, native JavaScript types are used. Some custom types are required:

    Symbol            A Lisp symbol.
    Environment       Lisp environment with parent support.
    Lambda            A callable JavaScript function, but also a Lisp lambda,
                      with arguments, body, and pointer to environment.
    Macro             A special type of Lambda that does not immediately evaluate the
                      arguments.
    SpecialFunction   A builtin procedure that can reference the current environment.
    Tuple             A special type of list.
