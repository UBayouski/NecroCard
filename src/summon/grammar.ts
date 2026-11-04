// NecroTalk grammar summary for the model (summon REQ-1.1 item 4). Mirrors docs/BRIEF.md section 4 and
// .kiro/steering/necrotalk.md; prompts.test.ts parses every example with the real parser.

export interface GrammarExample {
  title: string;
  script: string;
}

export const GRAMMAR_EXAMPLES: readonly GrammarExample[] = [
  {
    title: 'A navigation button with a visual effect',
    script: ['on mouseUp', '  visual effect dissolve', '  go next', 'end mouseUp'].join('\n'),
  },
  {
    title: 'Putting text and numbers into fields',
    script: [
      'on mouseUp',
      '  put "Correct!" into field "Feedback"',
      '  put field "Score" + 1 into field "Score"',
      '  put " Well done." after field "Feedback"',
      'end mouseUp',
    ].join('\n'),
  },
  {
    title: 'answer with buttons; the choice is in it',
    script: [
      'on mouseUp',
      '  answer "Open the crypt?" with "Yes" or "No"',
      '  if it is "Yes" then',
      '    go to card "Crypt"',
      '  else',
      '    put "You walk away." into field "Story"',
      '  end if',
      'end mouseUp',
    ].join('\n'),
  },
  {
    title: 'if / else if / else',
    script: [
      'on mouseUp',
      '  put field "Score" into total',
      '  if total > 2 then',
      '    put "Ghost master" into field "Rank"',
      '  else if total > 0 then',
      '    put "Apprentice" into field "Rank"',
      '  else',
      '    put "Mortal" into field "Rank"',
      '  end if',
      'end mouseUp',
    ].join('\n'),
  },
  {
    title: 'repeat loops',
    script: [
      'on mouseUp',
      '  put "" into field "Count"',
      '  repeat with i = 1 to 3',
      '    put i & " " after field "Count"',
      '  end repeat',
      '  repeat 2 times',
      '    beep',
      '  end repeat',
      'end mouseUp',
    ].join('\n'),
  },
  {
    title: 'A stack script: a global shared by handlers, and a custom handler in the same script',
    script: [
      'on openStack',
      '  global score',
      '  put 0 into score',
      'end openStack',
      '',
      'on mouseUp',
      '  addPoint 1',
      'end mouseUp',
      '',
      'on addPoint amount',
      '  global score',
      '  put score + amount into score',
      '  put score into field "Score"',
      'end addPoint',
    ].join('\n'),
  },
  {
    title: 'openCard: reset the card when it opens',
    script: [
      'on openCard',
      '  put "" into field "Answer"',
      '  hide field "Answer"',
      '  set the label of button "Reveal" to "Reveal"',
      '  show button "Reveal"',
      'end openCard',
    ].join('\n'),
  },
  {
    title: 'ask, chunks and functions',
    script: [
      'on mouseUp',
      '  ask "What is your name?" with "Wanderer"',
      '  put "Welcome, " & word 1 of it & "!" into field "Greeting"',
      '  put "Card " & random(the number of cards) into field "Hint"',
      '  if length(it) > 10 then put "A long name." into field "Note"',
      'end mouseUp',
    ].join('\n'),
  },
];

const examplesText = GRAMMAR_EXAMPLES.map(e => `-- ${e.title}\n${e.script}`).join('\n\n');

/** The tokenizer's KEYWORDS, copied so this module has no runtime import of src/interp (checked by a test). */
export const RESERVED_WORDS: readonly string[] = [
  'on', 'end', 'if', 'then', 'else', 'repeat', 'exit', 'pass',
  'go', 'to', 'card', 'next', 'prev', 'first', 'last',
  'put', 'into', 'before', 'after', 'get', 'set', 'of',
  'global', 'answer', 'with', 'or', 'ask', 'show', 'hide', 'beep',
  'visual', 'effect', 'dissolve', 'wipe', 'left', 'right', 'scroll', 'up',
  'and', 'not', 'is', 'contains',
  'the', 'times', 'while', 'mod',
  'true', 'false',
  'button', 'field', 'image', 'background', 'stack', 'me',
  'number', 'words', 'lines', 'chars', 'cards',
  'word', 'line', 'char', 'it',
];

export const GRAMMAR_SUMMARY = `NecroTalk is a small, frozen subset of HyperTalk. Use only what is listed here.

Handlers:
  on <handlerName> [param1, param2]
    <statements, one per line>
  end <handlerName>
A script is zero or more handlers. Comments start with --.
System messages: mouseUp, mouseDown (buttons and fields; mouseUp is the usual click), openCard, closeCard,
openStack. A message goes object -> card -> background -> stack; the first script with a matching handler runs it.
"pass <handlerName>" hands the message on to the next script in that order.
A statement that is just a name, like "addPoint 1", calls the handler with that name in the SAME script. To share a
handler between buttons, put it in the card, background or stack script together with the mouseUp handler that
calls it, or repeat it in each script.

Commands:
  go to card <number> | go to card "<card name>" | go next | go prev | go first | go last
  visual effect dissolve | visual effect wipe left | visual effect wipe right | visual effect scroll up
    (applies to the next go)
  put <expr> into <container>   (also: before <container>, after <container>)
    containers: field "<name>", a variable, it
  get <expr>                    (puts the value into it)
  set [the] <property> of <object> to <expr>
    properties: visible (button, field, image), label (button), text (field)
  global <variableName>         (in every handler that uses the stack-wide variable)
  answer <expr> [with "<button1>" [or "<button2>" [or "<button3>"]]]   (the clicked button is in it)
  ask <expr> [with <default>]   (the typed text is in it)
  show <object> | hide <object>
  beep
  if <expr> then <one statement>
  if <expr> then / [else if <expr> then] / [else] / end if   (multi-line form)
  repeat <n> times / repeat with <var> = <a> to <b> / repeat while <expr>   ... end repeat
  exit <handlerName> | exit repeat | next repeat

Objects: button <name>, field <name>, image <name>, card <name>, me. A name is usually a string literal:
field "Score". Use the object's "name" property, never its id or label. A field in an expression means its text.
There are no background or stack references.

Expressions: numbers, "strings" (double quotes only, no escapes), true, false, variables (unquoted words).
  arithmetic + - * / mod ^ and unary -;  concatenation & and && (&& adds a space);  parentheses
  comparison = <> < > <= >= is, is not, contains;  logic and, or, not
  the <property> of <object>;  the number of cards;  the number of words|lines|chars of <expr>
  the date;  the time;  random(<n>);  length(<expr>);  word <n> of <expr>;  line <n> of <expr>;  char <n> of <expr>

Reserved words cannot be variable or handler names: ${RESERVED_WORDS.join(' ')}.

Not supported (never use): do, sort, send, find, play, item, the target, chunk ranges (word 2 to 4), putting into
a chunk, number formatting, menus, paint commands, external commands, quotes inside strings.

Examples:

${examplesText}`;
