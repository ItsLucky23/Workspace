diagram builder - [
  <!-- use case diagram ( look at PlantUML vscode extensions, idea is to make this but we force alot of values from dropdowns and make a 2d grid and give everything a location so that we can use AI to make them. example being we have a boilerplate text wich you need to paste in ai and based on this info the ai can generate a UCD and we can import it and edit it easily)
  description at the bottom or next to the diagram
  img export
  ...other diagrams -->
  Types of diagrams:
    Use Case Diagram (UCD)
    Flowchart
    Class Diagram
    Entity-Relationship Diagram (ERD)

  Features:
    Force certain values via dropdowns to keep data structured (good for AI generation later)
    Auto-arrange items on the 2D grid, but allow manual repositioning
    Add descriptions at the bottom or side of each diagram element
    Export: PNG, SVG, PDF
    AI integration: Provide boilerplate text or prompts → AI generates diagram nodes/edges
    Element styles: color coding for types of elements (actors, systems, processes, etc.)
    Templates: pre-made diagram templates for common cases

  Possible enhancements:
    Version history for diagrams
    Comments/annotations on each node
    Import diagrams from PlantUML or other standard formats
]

User Story - [
  <!-- simple table with 3 columns where they go like
  "As USER" | "I wanna be able to FUNCTIONALITY" | "Because REASON"
  As a teacher | I wanna be able to see student results | because i wanna be able to monitor them

  the default values like "As", "I wanna be able to FUNCTIONALITY" and "Because REASON" you can change cause they are in a input field but just the default values -->
  Columns:
    Default: As [USER] | I want to [FUNCTIONALITY] | Because [REASON]
    Optional columns
  Features:
    Inline editing of cells
    Add/remove rows dynamically
    Drag & drop rows for ordering
    Default values auto-populate, but editable
    Highlight incomplete stories or missing fields
  Enhancements:
    Filter by user role or priority
    Export to CSV, Markdown, or PDF
    Link user stories to requirements or diagrams for traceability
]

requirements report - [
  simple table with columns you can enable/disable
  X amount of questions so that you can ask yourself does this requirement fulfill these questions
]

Columns: Requirement ID, Description, Status, Priority, Assigned To, Compliance Check (Y/N), Notes

Features:

Enable/disable columns dynamically

Add checklist questions for each requirement (e.g., “Does it have measurable acceptance criteria?”)

Highlight requirements that don’t meet certain criteria

Export options: PDF, CSV

Enhancements:

AI suggestions for missing or incomplete requirements

Versioning/history of requirement changes

Tags for categories or features

notes - [
  simple notes,
  sorted list,
  unsorted list

  changable font sizes
  changable text color
]

drawing - [
  draw freely,
  change size,
  change color,
  erase,
  change erase size
]

code blocks - [

]





geidentificeerd
grammaticaal correct
atomain (moet aan 1 eis voldoen dus niet (authentication system: login and register system (FOUT)))
geen verboden woorden (Expensive, cheap, quick, easy (heeft een andere betekenis in ieder zijn oog, voor anja is 100 euro duur en voor john is 300 euro goedkoop))
geen ontwerpaspecten
uniform gedefineerd
meetbaar
onderling consistent
geprioriteerd
eigenaar
geaccepteerd
tracebaar (waar gebruikt)