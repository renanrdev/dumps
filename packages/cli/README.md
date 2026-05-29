# @renanrdev/dumps

CLI for [dumps.sh](https://dumps.sh) — ephemeral pastebin.

```bash
npm install -g @renanrdev/dumps
```

```bash
cat error.log | dumps
kubectl describe pod x | dumps --ttl=1h
echo "$DB_PASSWORD" | dumps --burn
```

Full documentation: [github.com/renanrdev/dumps](https://github.com/renanrdev/dumps)
