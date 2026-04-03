# Research Methodology: Using AI Tools as Structured Steps

## Overview

This document outlines the structured approach for conducting research using AI tools as todo list steps, rather than traditional web search methods.

---

## Research UI: Todo List Visualization

During the research process, the UI displays a live todo list showing each step's progress:

```
╔══════════════════════════════════════════════════════════════════╗
║                    RESEARCH IN PROGRESS                          ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  [✓] Todo 1: Initial Codebase Exploration                        ║
║      └─ Status: COMPLETED                                        ║
║      └─ Tool: explore agent (background)                        ║
║      └─ Result: Repository structure mapped                     ║
║                                                                  ║
║  [✓] Todo 2: Configuration Analysis                              ║
║      └─ Status: COMPLETED                                        ║
║      └─ Tool: explore agent (parallel)                          ║
║      └─ Result: Dependencies & build systems understood          ║
║                                                                  ║
║  [◯] Todo 3: Documentation Review                               ║
║      └─ Status: IN PROGRESS                                      ║
║      └─ Tool: explore agent (background)                        ║
║      └─ Finding: AGENTS.md, CLAUDE.md, replit.md...             ║
║                                                                  ║
║  [ ] Todo 4: Implementation Deep Dive                            ║
║      └─ Status: PENDING                                          ║
║      └─ Tool: explore agent                                      ║
║      └─ Target: API routes, React components                     ║
║                                                                  ║
║  [ ] Todo 5: External Library Research                           ║
║      └─ Status: PENDING                                          ║
║      └─ Tool: librarian agent                                   ║
║      └─ Target: Official docs, GitHub examples                  ║
║                                                                  ║
║  [ ] Todo 6: Architecture Consultation                          ║
║      └─ Status: PENDING                                          ║
║      └─ Tool: oracle agent                                      ║
║      └─ Target: Validate findings, get recommendations           ║
║                                                                  ║
║  [ ] Todo 7: Synthesize & Document                               ║
║      └─ Status: PENDING                                          ║
║      └─ Tool: Direct synthesis + write                           ║
║      └─ Target: Research notes document                          ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  Progress: ████████░░░░░░░░░░░░░░░░░░  33% (2/6 completed)      ║
╚══════════════════════════════════════════════════════════════════╝
```

### Visual Legend:

- `[✓]` = Completed step
- `[◯]` = In progress
- `[ ]` = Pending
- `[⊘]` = Blocked (waiting for dependency)

### Real-time Updates:

The UI updates as each background agent completes, showing:

- Task status changes
- Tool being used
- Key findings summary
- Progress percentage

---

## Research Todo List Template

When conducting research, use the following structured steps with AI tools:

### Step 1: Initial Codebase Exploration

**AI Tool**: `explore` agent  
**Purpose**: Understand overall repository structure  
**Actions**:

- Launch explore agent to scan directory structure
- Identify key directories (artifacts, lib, scripts)
- Map out the codebase layout

**Example Command**:

```typescript
task((subagent_type = "explore"), (run_in_background = true), (prompt = "..."));
```

---

### Step 2: Configuration Analysis

**AI Tool**: `explore` agent  
**Purpose**: Understand project setup and dependencies  
**Actions**:

- Find and analyze package.json files
- Examine tsconfig.json configurations
- Review build scripts and dependencies

**Parallel Execution**: Run multiple explore agents simultaneously

---

### Step 3: Documentation Review

**AI Tool**: `explore` agent  
**Purpose**: Gather existing project knowledge  
**Actions**:

- Search for README.md files
- Review AGENTS.md and CLAUDE.md
- Check for architecture documentation

---

### Step 4: Implementation Deep Dive

**AI Tool**: `explore` agent  
**Purpose**: Analyze specific implementation details  
**Actions**:

- Research API server routes
- Examine React component structure
- Study integration patterns

---

### Step 5: Library/External Reference Research

**AI Tool**: `librarian` agent  
**Purpose**: Find official documentation and examples  
**Actions**:

- Research external libraries used in the codebase
- Find implementation examples from official docs
- Look up best practices from GitHub repositories

---

### Step 6: Architecture Consultation

**AI Tool**: `oracle` agent  
**Purpose**: Get high-level architecture guidance  
**Actions**:

- Consult on complex architectural decisions
- Validate research findings
- Identify potential issues or improvements

---

## AI Tool Categories

### For Internal Codebase Research:

1. **explore** - Contextual grep for finding patterns within the codebase
2. **code-reviewer** - Analyze code quality and patterns
3. **gsd-codebase-mapper** - Create structured analysis documents

### For External Reference Research:

1. **librarian** - Search official docs and GitHub examples
2. **context7** - Query documentation for specific libraries
3. **grep_app** - Find real-world code examples from GitHub

### For Synthesis and Analysis:

1. **oracle** - High-level architecture consultation
2. **metis** - Pre-planning analysis
3. **momus** - Review and validate findings

---

## Parallel Execution Strategy

When running research, maximize efficiency by:

1. **Fire multiple explore agents in parallel** for different aspects of the codebase
2. **Use librarian agents** for external library research simultaneously
3. **Direct tools (grep, glob)** for known file locations
4. **Collect all results** before synthesis

---

## Example Research Flow with UI States

### Phase 1: Launching Parallel Research

```
╔══════════════════════════════════════════════════════════════════╗
║         RESEARCH: Understanding API Implementation              ║
╠══════════════════════════════════════════════════════════════════╣
║  Starting parallel exploration...                                ║
║                                                                  ║
║  [◯] Todo 1: Explore API server structure                       ║
║      └─ Agent: bg_abc123 (running)                              ║
║      └─ Duration: 5s                                            ║
║                                                                  ║
║  [◯] Todo 2: Explore database schema                            ║
║      └─ Agent: bg_def456 (running)                              ║
║      └─ Duration: 5s                                            ║
║                                                                  ║
║  [◯] Todo 3: Research TypeScript patterns                       ║
║      └─ Agent: bg_ghi789 (running)                              ║
║      └─ Duration: 4s                                            ║
║                                                                  ║
║  [ ] Todo 4: Synthesize findings                                 ║
║  [ ] Todo 5: Document results                                    ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  Progress: ░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0% (0/5 completed)     ║
║  Background Tasks: 3 running                                     ║
╚══════════════════════════════════════════════════════════════════╝
```

### Phase 2: Collecting Results

```
╔══════════════════════════════════════════════════════════════════╗
║         RESEARCH: Understanding API Implementation              ║
╠══════════════════════════════════════════════════════════════════╣
║  Results arriving...                                             ║
║                                                                  ║
║  [✓] Todo 1: Explore API server structure                       ║
║      └─ Status: COMPLETED ✓                                      ║
║      └─ Found: Express 5 app, lazy route loading                ║
║      └─ Duration: 45s                                            ║
║                                                                  ║
║  [✓] Todo 2: Explore database schema                             ║
║      └─ Status: COMPLETED ✓                                      ║
║      └─ Found: Drizzle ORM, 3 tables (conversations, messages)  ║
║      └─ Duration: 48s                                            ║
║                                                                  ║
║  [◯] Todo 3: Research TypeScript patterns                        ║
║      └─ Agent: bg_ghi789 (running)                              ║
║      └─ Duration: 30s                                            ║
║                                                                  ║
║  [⊘] Todo 4: Synthesize findings                                 ║
║      └─ Status: BLOCKED (waiting for Todo 3)                     ║
║                                                                  ║
║  [⊘] Todo 5: Document results                                    ║
║      └─ Status: BLOCKED (waiting for Todo 4)                     ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  Progress: ████████░░░░░░░░░░░░░░░░░░  40% (2/5 completed)     ║
║  Background Tasks: 1 running, 2 completed                       ║
╚══════════════════════════════════════════════════════════════════╝
```

### Phase 3: Synthesizing Results

```
╔══════════════════════════════════════════════════════════════════╗
║         RESEARCH: Understanding API Implementation              ║
╠══════════════════════════════════════════════════════════════════╣
║  Synthesizing findings...                                        ║
║                                                                  ║
║  [✓] Todo 1: Explore API server structure                       ║
║      └─ Status: COMPLETED ✓                                      ║
║                                                                  ║
║  [✓] Todo 2: Explore database schema                             ║
║      └─ Status: COMPLETED ✓                                      ║
║                                                                  ║
║  [✓] Todo 3: Research TypeScript patterns                        ║
║      └─ Status: COMPLETED ✓                                      ║
║      └─ Found: Strict mode, schema-driven types                  ║
║                                                                  ║
║  [◯] Todo 4: Synthesize findings                                 ║
║      └─ Status: IN PROGRESS                                       ║
║      └─ Action: Analyzing results from 3 agents...              ║
║      └─ Finding: Schema → Codegen → API flow identified          ║
║                                                                  ║
║  [ ] Todo 5: Document results                                    ║
║      └─ Status: PENDING                                           ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  Progress: ████████████████░░░░░░░░░░  60% (3/5 completed)     ║
║  Synthesis: Building mental model...                             ║
╚══════════════════════════════════════════════════════════════════╝
```

### Phase 4: Research Complete

```
╔══════════════════════════════════════════════════════════════════╗
║         RESEARCH: Understanding API Implementation              ║
╠══════════════════════════════════════════════════════════════════╣
║  ✓ RESEARCH COMPLETE                                             ║
║                                                                  ║
║  [✓] Todo 1: Explore API server structure                       ║
║      └─ Found: Express 5, lazy routes, multi-provider chat      ║
║                                                                  ║
║  [✓] Todo 2: Explore database schema                             ║
║      └─ Found: Drizzle ORM, PostgreSQL, 3 tables                ║
║                                                                  ║
║  [✓] Todo 3: Research TypeScript patterns                       ║
║      └─ Found: Strict mode, OpenAPI → Orval codegen             ║
║                                                                  ║
║  [✓] Todo 4: Synthesize findings                                 ║
║      └─ Result: Complete architecture understanding             ║
║                                                                  ║
║  [✓] Todo 5: Document results                                    ║
║      └─ Output: .sisyphus/notepads/research-notes.md            ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  Progress: ██████████████████████████  100% (5/5 completed)    ║
║  Total Duration: 2m 15s                                          ║
║  Tokens Used: ~45,000                                            ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## Compact Tree View Format

```
Research Task: Understand the API implementation

├─ [✓] Todo 1: [Parallel] Explore API server structure
│  └─ Agent: explore (background) - DONE (45s)
│  └─ Result: Express 5 app, lazy route loading pattern
│
├─ [✓] Todo 2: [Parallel] Explore database schema
│  └─ Agent: explore (background) - DONE (48s)
│  └─ Result: Drizzle ORM, 3 tables defined
│
├─ [✓] Todo 3: [Parallel] Research TypeScript patterns
│  └─ Agent: librarian (background) - DONE (52s)
│  └─ Result: Strict TS config, OpenAPI codegen flow
│
├─ [✓] Todo 4: [Sequential] Synthesize findings
│  └─ Status: COMPLETED
│  └─ Result: Architecture mapped, patterns documented
│
└─ [✓] Todo 5: [Sequential] Document results
   └─ Status: COMPLETED
   └─ Output: research-notes.md created
```

---

## Key Principles

1. **Always use AI tools first** - Don't manually search when agents can do it
2. **Parallel execution** - Fire multiple agents simultaneously
3. **Trust but verify** - Collect and validate agent findings
4. **Document everything** - Keep track of research progress in todo lists
5. **No web search** - Use librarian and context7 for external references

---

## Research Completion Checklist

- [ ] Todo 1: Initial exploration complete
- [ ] Todo 2: Configuration analysis complete
- [ ] Todo 3: Documentation reviewed
- [ ] Todo 4: Implementation analyzed
- [ ] Todo 5: External references gathered
- [ ] Todo 6: Findings synthesized
- [ ] Todo 7: Research documented

---

## Tools Reference

| Tool                              | Purpose                   | When to Use                 |
| --------------------------------- | ------------------------- | --------------------------- |
| `task(subagent_type="explore")`   | Codebase exploration      | Finding patterns, structure |
| `task(subagent_type="librarian")` | External research         | Libraries, docs, examples   |
| `task(subagent_type="oracle")`    | Architecture consultation | Complex decisions           |
| `grep`                            | File content search       | Known patterns              |
| `glob`                            | File pattern matching     | Known file locations        |
| `read`                            | Direct file reading       | Known file paths            |

---

---

## Visual Indicator Reference

### Status Icons

| Icon  | Status      | Description                 |
| ----- | ----------- | --------------------------- |
| `[✓]` | Completed   | Task finished successfully  |
| `[◯]` | In Progress | Task currently running      |
| `[ ]` | Pending     | Task waiting to start       |
| `[⊘]` | Blocked     | Task waiting for dependency |
| `[✗]` | Failed      | Task encountered error      |

### Color Codes (Terminal)

- `✓` Green: Success/completed
- `◯` Yellow: In progress/running
- `⊘` Blue: Blocked/waiting
- `✗` Red: Error/failed

### Progress Bar

```
████████░░░░░░░░░░░░░░░░░░  33%
```

- Each `█` = 4% progress
- `░` = remaining work

---

## Interactive Research Session Example

When you start a research session, the UI evolves through these states:

**1. Initial State**: All todos pending

```
╔══════════════════════════════════════════════════════════════════╗
║                    NEW RESEARCH SESSION                         ║
╠══════════════════════════════════════════════════════════════════╣
║  [ ] Todo 1: Initial exploration                                ║
║  [ ] Todo 2: Configuration analysis                              ║
║  [ ] Todo 3: Documentation review                               ║
║  [ ] Todo 4: Implementation dive                                ║
║  [ ] Todo 5: External research                                   ║
║  [ ] Todo 6: Consult oracle                                      ║
║  [ ] Todo 7: Document findings                                   ║
╠══════════════════════════════════════════════════════════════════╣
║  Ready to start. Waiting for instructions...                   ║
╚══════════════════════════════════════════════════════════════════╝
```

**2. Running State**: Parallel agents active

```
╔══════════════════════════════════════════════════════════════════╗
║           RESEARCH ACTIVE - Parallel Execution                  ║
╠══════════════════════════════════════════════════════════════════╣
║  [◯] Todo 1: Initial exploration         [running: 12s]         ║
║  [◯] Todo 2: Configuration analysis      [running: 12s]         ║
║  [◯] Todo 3: Documentation review        [running: 11s]         ║
║  [ ] Todo 4: Implementation dive         [pending]              ║
║  [ ] Todo 5: External research            [pending]              ║
║  [ ] Todo 6: Consult oracle               [pending]              ║
║  [ ] Todo 7: Document findings           [pending]              ║
╠══════════════════════════════════════════════════════════════════╣
║  Progress: ░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0% (agents running)  ║
║  Active: 3 explore agents | Background: yes                     ║
╚══════════════════════════════════════════════════════════════════╝
```

**3. Completion State**: Research finished

```
╔══════════════════════════════════════════════════════════════════╗
║          ✓ RESEARCH COMPLETE - All Tasks Done                  ║
╠══════════════════════════════════════════════════════════════════╣
║  [✓] Todo 1: Initial exploration         [done: 45s]           ║
║  [✓] Todo 2: Configuration analysis      [done: 48s]           ║
║  [✓] Todo 3: Documentation review        [done: 51s]           ║
║  [✓] Todo 4: Implementation dive        [done: 15s]           ║
║  [✓] Todo 5: External research           [done: 38s]           ║
║  [✓] Todo 6: Consult oracle              [done: 60s]           ║
║  [✓] Todo 7: Document findings           [done: 5s]            ║
╠══════════════════════════════════════════════════════════════════╣
║  Progress: ██████████████████████████  100% (7/7 completed)   ║
║  Total Time: 4m 22s | Peak Parallel: 3 agents                  ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## Conclusion

This methodology ensures systematic, thorough research using AI tools as structured steps. Each todo item maps to a specific AI tool or direct tool, enabling efficient and comprehensive codebase exploration without relying on web search.

The UI visualization provides real-time feedback on research progress, showing which agents are running, what's blocked, and what's been completed. This transparency helps track complex parallel research operations and ensures no steps are missed.
