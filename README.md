# x-win browser cost

Measures what reading the active browser tab's address with [x-win](https://github.com/miniben-90/x-win)
(UI Automation) costs Chrome and Edge on Windows: browser CPU and memory, main-thread stalls on a page that
changes ten times a second, and whether the browser turns its accessibility mode on.

Runs on a GitHub Windows runner on every push. Results are in the job summary and the `results` artifact.
