import os
import requests
import urllib3

# AirOS ships a self-signed cert; silence the warning for the LAN call.
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class RocketReader:
    """Reads per-antenna-chain signal from a Ubiquiti AirOS radio.

    Uses the radio's HTTPS JSON API (status.cgi) instead of SSH: AirOS only
    offers legacy ssh-rsa host keys, which modern SSH stacks reject, and the
    chain RSSI we need is exposed directly over the web API anyway.

    Differential locating: the base radio reports the remote station's signal
    on each receive chain (chainrssi). The left/right balance between the two
    chains (chain0 - chain1) points toward the transmitter; their average is
    overall link strength.
    """

    def __init__(self, host=None, user=None, password=None):
        self.host = host or os.getenv("ROCKET_HOST", "192.168.1.20")
        self.user = user or os.getenv("ROCKET_USER", "wfrdaq")
        self.password = password or os.getenv("ROCKET_PASS", "westernformularacing")
        self.base = f"https://{self.host}"
        self.session = requests.Session()
        self.session.verify = False
        self._logged_in = False

    def _login(self):
        # Prime the session cookie, then post credentials.
        self.session.get(f"{self.base}/login.cgi", timeout=6)
        self.session.post(
            f"{self.base}/login.cgi",
            data={"username": self.user, "password": self.password, "uri": "/status.cgi"},
            timeout=6,
        )
        self._logged_in = True

    def get_status(self):
        """Return {'chain0': int, 'chain1': int} or None if no station is linked."""
        if not self._logged_in:
            self._login()

        resp = self.session.get(f"{self.base}/status.cgi", timeout=6)
        if resp.status_code != 200:
            # Session expired — re-auth once and retry.
            self._login()
            resp = self.session.get(f"{self.base}/status.cgi", timeout=6)

        try:
            data = resp.json()
        except ValueError:
            return None

        return self.parse(data)

    def parse(self, data):
        """Pull chain0/chain1 RSSI from the first connected station."""
        stations = data.get("wireless", {}).get("sta") or []
        if not stations:
            return None

        chains = stations[0].get("chainrssi") or []
        if len(chains) < 2:
            return None

        return {
            "chain0": int(chains[0]),
            "chain1": int(chains[1]),
        }

    def compute_direction(self, c0, c1):
        error = c0 - c1
        strength = (c0 + c1) / 2
        return {
            "error": error,
            "strength": strength,
        }

    def normalize(self, error):
        return max(min(error / 20.0, 1), -1)


if __name__ == "__main__":
    reader = RocketReader()
    data = reader.get_status()
    if data:
        direction = reader.compute_direction(data["chain0"], data["chain1"])
        print(f"chain0={data['chain0']}, chain1={data['chain1']}, "
              f"error={direction['error']}, normalized={reader.normalize(direction['error']):.2f}, "
              f"strength={direction['strength']:.1f}")
    else:
        print("No connected station (no chain data) — radio reachable but link is down")
