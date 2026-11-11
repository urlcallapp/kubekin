# KubeKin

Free, open-source, browser-based relationship map for Kubernetes manifests, with an editable YAML copy next to it.

- Load YAML by paste, public raw Git URL (GitHub/GitLab blob links are converted), or local files.
- Boxes are resources grouped by namespace; typed arrows: **owns** (explicit ownerReferences), **selects** (label match, inferred, dashed), **references** (named refs: ConfigMap, Secret, PVC, ServiceAccount, HPA target, RoleBinding, ...), **routes** (Ingress / Gateway API backends).
- Click a box or problem to jump to the exact YAML lines; click YAML to highlight the box. Original text stays separate from the editable working copy.
- Unknown custom resources appear as plain boxes with no invented links. No live Pods are invented; the map is derived from the text only.
- Helm: shows `helm template ... | xclip / wl-copy / pbcopy / Set-Clipboard` commands, then paste the output.
- Fully static. No data leaves the browser except the URL fetches you request.

## Run

    npm ci && npm run dev        # development
    npm test                     # unit tests
    docker build -t kubekin . && docker run --rm -p 8080:8080 kubekin   # offline-capable, icons bundled

## Credits

Icons: [kubernetes/community icons](https://github.com/kubernetes/community/tree/main/icons), Apache-2.0 (see LICENSE-k8s-icons.txt). Layout: ELK (elkjs, EPL-2.0). Graph: React Flow (MIT). Editor: CodeMirror 6 (MIT). YAML: eemeli/yaml (ISC).
Inspired by Konstellate, KubeDiagrams and Monokle; no code reused.

## Limits (v0.1)

Public raw URLs only (CORS applies). Selector matches are inferences. Helm/Kustomize must be rendered first.

## Map behavior and current limits

The graph uses ELK orthogonal routes within each namespace; cross-namespace edges use a fallback route. These are manifest relationships, not a live cluster topology. `ownerReferences` are explicit; selectors against pod templates are inferred. A referenced object not loaded here is marked "not in input", not declared missing from the cluster.

Maps with more than 40 resources start in a simplified view, hiding ConfigMap, Secret, ServiceAccount, PVC, PV and StorageClass boxes. The banner and "config & storage" checkbox restore them. Clicking a hidden resource in YAML also restores it. Click a box to center/zoom it and inspect its full relationships. Pan and zoom for dense inputs.

Valid YAML documents still map if another document has a syntax error; a red banner makes the incomplete map explicit. Duplicate YAML keys are rejected. This is not a Kubernetes schema validator, RBAC checker, deployment tool or general-purpose IDE. Resource identity uses API group, kind, namespace and name (versions share identity). Supplied CRDs determine custom-resource scope. Without a known rule or supplied CRD, scope is marked unknown and no namespace is silently assumed. Ambiguous group/scope references produce a note without a guessed link.

No analytics or remote fonts. The application, editor, graph library and Kubernetes icon set are bundled into the static build. URL import is intentionally network-dependent and only works where the URL server permits CORS. Docker build needs access to the base images and npm dependencies; the resulting static image needs no internet for paste/file mapping. Docker build and runtime were verified by the Container smoke test on GitHub-hosted Ubuntu. It builds without publishing an image, checks nginx with the container network disabled, and tests the browser UI with all non-local requests blocked. The smoke test covers local icons, sample mapping, graph-to-YAML and YAML-to-graph navigation, paste/file import and the Helm dialog. See the repository Actions tab for the current run result.
