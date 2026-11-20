# Security policy

## Reporting a vulnerability

**Please do not post the details of a vulnerability in a public issue, discussion or pull request.** Reports are
handled privately over SimpleX, after a short verification step that links you to your GitHub identity. The
verification means the maintainer can credit you properly, and you only ever have to do it once.

1. **Open a content-free issue.** Use the *Security contact request* form
   ([new issue](../../issues/new?template=security_contact.yml)). It must say *only* that you have a security matter.
   No details, no sample files, no exploit.
2. **Connect over SimpleX** at
   **<https://smp14.simplex.im/a#3gZ-zeHs4QrFZKLAN0o3SC_XQJXhj1eYBVTO_c0FAtg>**
   using the [SimpleX Chat](https://simplex.chat) app ("Connect via link"). No account, phone number or email is
   needed. Your first message should be the issue's number.
3. **Verify each other over the issue.** A public-key signature exchange, so each side knows who it is talking to:
   * *You:* sign a short statement with an SSH key that is listed on your GitHub account
     (`https://github.com/<you>.keys`) and paste the statement and the signature into the issue:

     ```
     printf '%s\n' "I am <your GitHub name>, security matter in issue #<n>, SimpleX name <your SimpleX name>." > message.txt
     ssh-keygen -Y sign -f <path to your private key> -n ksp-commnet-security message.txt
     ```

     This writes `message.txt.sig`. (An SSH *signing* key registered on your GitHub account works too.)
   * *The maintainer:* verifies it, then replies in the issue with a statement of their own, signed with the
     maintainer's signing key below. You can check it:

     ```
     printf '%s\n' "slammingprogramming ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIHSyg1EK6pjVGJaDawe37NFKpL9sasrvGU/NLz7I73M" > allowed_signers
     ssh-keygen -Y verify -f allowed_signers -I slammingprogramming -n ksp-commnet-security -s reply.sig < reply.txt
     ```

     The same key signs this repository's commits and tags (GitHub shows them as *Verified*), and its fingerprint is
     `SHA256:BI8iHdCvNsTY5x5s2tZNNdJYl3SHlkRGAXE2KhazaGY`.
4. **Send the details over SimpleX only.** Once both sides are verified the issue is closed with nothing sensitive in
   it, and you can contact the maintainer on that same SimpleX connection from then on without repeating the steps.

Please include, as far as you can:

* what the problem is and which part of the app it affects (a tab, a parser, an import feature);
* the steps or a small sample file to reproduce it (a part `.cfg`, a Kopernicus config or a `persistent.sfs`
  that triggers it, with anything personal removed);
* the browser and version you used, and whether it also happens when `index.html` is opened from disk;
* what you think the impact is.

This is a hobby project run by one person, so there is no formal response-time guarantee, but verified reports are
read first. Please give the maintainer a reasonable chance to fix a problem before you make it public; credit is given
to the GitHub account you verified, unless you prefer to stay anonymous.

## What is in scope

KSP CommNet Workbench is a static web app. It has no server, no accounts and sends nothing anywhere: everything runs in
your browser and the only thing it stores is its own settings in `localStorage`. The realistic risks are therefore in
how it handles files you give it, for example:

* the parsers for part `.cfg` files, Kopernicus planet-pack configs and `persistent.sfs` saves (crashes, runaway
  memory or CPU use, or anything that could run script or inject markup into the page);
* cross-site scripting through names or text that end up displayed in the UI (the app builds its interface with
  `textContent`, never `innerHTML` on imported data, so any exception to that is a bug);
* the build and release workflows in `.github/`;
* anything that would make the app send data off your machine.

Wrong CommNet results or inaccurate game data are ordinary bugs: please use a normal
[issue](../../issues) for those.

## Supported versions

Only the latest release (and the current `main` branch) receives fixes.
