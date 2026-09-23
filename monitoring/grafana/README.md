# Grafana Alerting - Discord

This directory contains Grafana Alerting provisioning files for the Banking project.

## What is included

- `alert-rules.yaml`: Grafana-managed alert rule for HTTP 5xx error rate.
- `contact-points.yaml`: Discord contact point. The Discord webhook is read from the `DISCORD_WEBHOOK_URL` environment variable.

## Alert rule

The rule:

- Name: `Banking - HTTP 5xx error rate > 5%`
- Evaluation interval: 1 minute
- Pending period: 5 minutes
- Condition: HTTP 5xx error rate > 5%

The application already exposes Prometheus metrics from `services/common/observability.py`, including:

- `http_requests_total`
- `http_request_duration_seconds`

The alert query uses:

```promql
100 *
(
  sum(rate(http_requests_total{status=~"5.."}[5m]))
  /
  clamp_min(sum(rate(http_requests_total[5m])), 0.001)
)
```

## Before enabling

1. Prometheus must be scraping the `/metrics` endpoint of the Banking services.
2. Grafana must have a Prometheus data source.
3. Set `PROMETHEUS_DATASOURCE_UID` to the UID of that Grafana Prometheus data source.
4. Create a Discord webhook and set `DISCORD_WEBHOOK_URL` in the Grafana environment. Do not commit the real webhook URL to Git.
5. Copy these files into Grafana's `provisioning/alerting/` directory and reload/restart Grafana.

Grafana file provisioning is for self-hosted Grafana. For Grafana Cloud, create the Contact Point and Alert Rule in the Grafana UI instead.

## Connect the rule to Discord

After provisioning, open:

`Alerting -> Alert rules`

Edit `Banking - HTTP 5xx error rate > 5%` and select the `banking-discord` contact point under Notifications if your Grafana instance does not already route the rule through a notification policy.

Test the contact point from:

`Alerting -> Notification configuration -> Contact points -> banking-discord -> Test`

## Important

This repository does not currently contain a Prometheus/Grafana deployment manifest, so these files are intentionally kept as Grafana provisioning assets rather than pretending Grafana itself is deployed by this Kubernetes project.
