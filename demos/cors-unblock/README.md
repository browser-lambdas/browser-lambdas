# CORS unblock

Run `baah push <connection>` here and approve the import. Enable **Allow network rules** in Settings, then **Network rules** in this project’s Functions settings.

On the page making the blocked request, run:

```sh
cors-unblock https://api.example.com/*
```

For custom request headers or credentials:

```sh
cors-unblock https://api.example.com/* --headers "Content-Type, Authorization, X-Api-Key" --credentials
```

Rules survive refresh and clear when the tab changes origin or closes.
