# NOTICE

Third-party material bundled into the deployed application.
Doctrine §8: licensing of shipped code is load-bearing and declared, not assumed.

---

## suncalc

The only runtime dependency. Bundled into the app JavaScript by vite; never
fetched from a CDN (spec §10). Used by the Sun & Moon module for solar and
lunar times and moon illumination.

Homepage: https://github.com/mourner/suncalc
License: BSD-2-Clause

```
Copyright (c) 2014, Vladimir Agafonkin
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

   1. Redistributions of source code must retain the above copyright notice, this list of
      conditions and the following disclaimer.

   2. Redistributions in binary form must reproduce the above copyright notice, this list
      of conditions and the following disclaimer in the documentation and/or other materials
      provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## Build and gate tooling (NOT shipped to a browser)

These run on a developer machine or a CI runner and are never redistributed
as part of the deployed site. Listed for completeness, per Doctrine §16.3:
"declare every dependency, even for a one-file script."

- vite — MIT — bundler
- axe-core — MPL-2.0 — accessibility gate
- playwright-core — Apache-2.0 — headless browser for the gates
