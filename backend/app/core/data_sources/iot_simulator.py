"""
Standalone IoT sensor simulator. Publishes synthetic soil-moisture and
water-level readings over MQTT for a set of "instrumented" demo villages.

Run standalone during the demo:
    python -m app.core.data_sources.iot_simulator

Requires a local MQTT broker (e.g. Mosquitto) running on localhost:1883 --
deliberately NOT a public broker, to avoid depending on external network
reliability during the live demo.
"""
import json
import random
import time

import paho.mqtt.client as mqtt

from app.config import get_settings

INSTRUMENTED_VILLAGE_IDS = ["v1", "v3"]  # subset of demo_villages.json ids
PUBLISH_INTERVAL_SECONDS = 10


def simulate_reading(baseline_moisture: float = 0.30, baseline_water_level_m: float = 0.5,
                      storm_mode: bool = False) -> dict:
    moisture_noise = random.uniform(-0.01, 0.01)
    level_noise = random.uniform(-0.02, 0.02)
    if storm_mode:
        moisture_noise += random.uniform(0.02, 0.06)
        level_noise += random.uniform(0.05, 0.20)
    return {
        "soil_moisture": round(max(0.0, min(0.6, baseline_moisture + moisture_noise)), 4),
        "water_level_m": round(max(0.0, baseline_water_level_m + level_noise), 3),
        "timestamp": time.time(),
    }


def run_publisher(storm_mode: bool = False):
    settings = get_settings()
    client = mqtt.Client()
    client.connect(settings.mqtt_broker_host, settings.mqtt_broker_port, keepalive=60)
    client.loop_start()

    print(f"Publishing simulated IoT data for villages: {INSTRUMENTED_VILLAGE_IDS}")
    try:
        while True:
            for village_id in INSTRUMENTED_VILLAGE_IDS:
                reading = simulate_reading(storm_mode=storm_mode)
                topic = f"sensors/{village_id}/telemetry"
                client.publish(topic, json.dumps(reading))
                print(f"Published to {topic}: {reading}")
            time.sleep(PUBLISH_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        print("Stopping IoT simulator.")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    run_publisher(storm_mode=False)
