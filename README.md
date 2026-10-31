# x-win browser cost

Measures what reading the active browser tab's address through UI Automation costs Chrome and Edge on Windows.
Earlier runs compared [x-win](https://github.com/miniben-90/x-win), which reads Chrome's address from the web page,
with `read-address.ps1`, which looks only at the address bar. The current run tests `electron/native/address-bar-reader.cs`,
a long-lived reader of the address bar only, built by `electron/scripts/build-address-bar-reader.js`. For each it
records browser CPU and memory, main-thread stalls on a page that changes ten times a second, which accessibility
modes the browser turns on, and the reader's own CPU and memory.

Runs on a GitHub Windows runner on every push. Results are in the job summary and the `results` artifact.
