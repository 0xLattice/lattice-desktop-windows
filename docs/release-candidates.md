# Release candidates

Build candidates through this repository's native CI, from a reviewed commit
with recursive submodules at their recorded revisions. CI packages the exact
shared application and includes dependency notices collected from its pinned
source and installed dependency graphs. Collection fails if a required notice
or source-scoped grant cannot be verified; third-party attribution is preserved.
The Swift 6.1 notice comes from swiftlang/swift at swift-6.1-RELEASE/LICENSE.txt.

Download the successful workflow's platform artifact and compute SHA-256 for
each installer. Inspect extracted contents, metadata, source paths and notices
before signing. Record the commit, workflow run, artifact ID, architecture,
requirements and test limitations with those checksums. A CI artifact is a
candidate, not a published release.

Keep checksum signing separate from building. Use the existing project
Minisign key through an interactive local signing handoff; never copy a private
key or passphrase into the repository or CI. Verify the detached signature
against the already-published project public key before publication. Release
publication and tags require separate approval. Do not alter the Mac release.
