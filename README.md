# x-win browser cost

Measures what reading the active browser tab's address through UI Automation costs Chrome and Edge on Windows:
[x-win](https://github.com/miniben-90/x-win), which reads Chrome's address from the web page, against
`read-address.ps1`, which looks only at the address bar. For each it records browser CPU and memory, main-thread
stalls on a page that changes ten times a second, and which accessibility modes the browser turns on.

Runs on a GitHub Windows runner on every push. Results are in the job summary and the `results` artifact.
