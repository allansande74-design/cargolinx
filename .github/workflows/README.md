# Workflows in this repository

`ci.yml.disabled` is the workflow CargoLinx used while GitHub-hosted runners were available.
The job was rejected before its first step (2 seconds, zero steps, no runner assigned, no log
blob) and the cause sits above this repository — account-level runner availability, not the
workflow and not the code. It was verified separately that the same commit installs, tests
(513 passing) and builds cleanly on a plain Linux machine.

So the checks moved off GitHub:

- the suite is run by the build machine before each deploy and its real output is committed to
  `docs/TEST-RUN.md`;
- the production build and the deploy to Cloudflare are done from the same machine.

The file is kept in the tree, renamed with a `.disabled` suffix, so the checks stay readable and
can be restored by renaming it back to `ci.yml` once runners are available again. A disabled
workflow produces no check runs, so no commit shows a red cross for a job that never started.
