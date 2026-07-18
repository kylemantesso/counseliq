# Renderer service

## Avatar render input

Avatar footage is optional and uses the shared `RenderAvatarTrack` contract:

```json
{ "objectKey": "sha256/<content-hash>.mp4" }
```

For a published render, place this value at `units[].avatarTrack` in the
frozen manifest. The renderer validates and removes that optional metadata
before parsing the current strict publish-manifest schema, then presigns its
`objectKey`. Its key must also be present in the manifest's `artifactKeys` set.
The optional `avatarTrack` field on a render request is a fallback for manifests
produced before that metadata is available. Frozen unit metadata takes
precedence when both are present.
