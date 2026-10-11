"""Rule-based maintenance logic. Kept separate from the models on purpose:
the models produce risk and failure-mode probabilities; these rules turn them into
alert levels and work orders, and can be changed by operations without retraining."""

CRITICAL_RISK = 0.80

ACTIONS = {
    "TWF": "Replace the worn tool and reset the tool-wear counter.",
    "HDF": "Inspect cooling: fans, airflow and heat exchangers. The process/air temperature gap is too small.",
    "PWF": "Inspect motor and power supply. Power draw is outside the safe operating window.",
    "OSF": "Reduce load and replace the tool. Torque on a worn tool is overstraining the equipment.",
}
GENERAL_ACTION = "Run a general inspection. The model flags failure risk but no specific failure mode."


def alert_level(risk, threshold):
    """Normal < threshold/2 <= Watch < threshold <= Alert < 0.80 <= Critical."""
    if risk >= max(CRITICAL_RISK, threshold):
        return "Critical"
    if risk >= threshold:
        return "Alert"
    if risk >= threshold / 2:
        return "Watch"
    return "Normal"


def recommendation(level, predicted_modes):
    if level in ("Normal", "Watch"):
        return {
            "dispatch_maintenance": False,
            "suggested_action": "No action." if level == "Normal" else "Keep monitoring; check again next reading.",
        }
    actions = [ACTIONS[m] for m in predicted_modes if m in ACTIONS] or [GENERAL_ACTION]
    return {"dispatch_maintenance": True, "suggested_action": " ".join(actions)}
