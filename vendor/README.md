# Offline PDF dependencies

The report bundles these files directly into its standalone HTML. It does not
load a CDN, call a PDF service, or require a local server.

- `html2canvas.min.js`: html2canvas 1.4.1, from its official npm package.
- `jspdf.umd.min.js`: jsPDF 4.2.1, from its official npm package.

`versions.json` records each pinned package version, upstream tarball URL and
SHA-512 integrity value, plus SHA-256 hashes of the vendored bundle and license.
The tarballs were verified against npm integrity before these files were copied.
The complete MIT licenses are retained alongside the bundles.

To update a dependency, select an exact release, verify its upstream package
integrity, replace the distribution bundle and license, refresh `versions.json`,
and run the PDF module and real offline download checks before rebuilding.
