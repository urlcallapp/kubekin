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
