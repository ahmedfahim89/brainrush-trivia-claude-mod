# BrainRush trivia for Claude Code

A Claude Code mod that shows [BrainRush](https://brainrush.integration.ninja/index.html) trivia questions above the prompt while Claude is working, so the wait is a quiz instead of idle time.

- The band appears while a turn runs (subagents inside the turn included) and hides when Claude is done.
- Click the band (or press ctrl+x tab), then **1** Reveal / **2** Skip; after revealing, **1** Got it / **2** Missed.
- Questions come live from the BrainRush site's public API (text questions only). Questions you have seen are sent back so they don't repeat. Your score and seen list stay on your machine.
- `/trivia` shows your score; `/trivia off`, `/trivia on`, `/trivia reset`.

Needs a recent Claude Code and internet access to the BrainRush site. Works in the terminal and the desktop app.

## Install

At the prompt of a terminal session:

```
/plugin install brainrush-trivia --marketplace ahmedfahim89/brainrush-trivia-claude-mod
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```
claude plugin install brainrush-trivia --marketplace ahmedfahim89/brainrush-trivia-claude-mod
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `ahmedfahim89/brainrush-trivia-claude-mod`, then **Add plugin**.

## Develop

`claude plugin validate .` and `claude plugin test .` check the mod; the code is `hooks/register.tsx`.
