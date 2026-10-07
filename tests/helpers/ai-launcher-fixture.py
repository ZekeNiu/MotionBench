"""Real launcher/DPAPI with an in-process synthetic upstream, never the network."""
import argparse
import importlib.util
import io
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("motionbench_fixture_server", root / "scripts/serve.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SyntheticProvider:
    def open(self, request, timeout):
        if not request.full_url.startswith("https://ai-test.invalid/v1/"):
            raise ValueError("Synthetic fixture rejects every other provider")
        credential = request.headers["Authorization"].removeprefix("Bearer ")
        if request.full_url.endswith("/models"):
            payload = {"data": [{"id": "image-only"}, {"id": "chat-model"}], "upstreamEcho": credential}
        else:
            payload = {"choices": [{"message": {"content": "## 综合判断\n\n结合本次跳跃与力量结果，优先提高可控制动作范围内的发力能力，并观察训练后的疲劳反应。\n\n## 下阶段安排\n\n周一安排分腿蹲3组，每组6次，组间休息2分钟；周四安排3组低强度跳跃，每组5次，保持动作质量。\n\n## 复测\n\n两周后按相同动作与设备复测，比较跳高、触地时间和主观疲劳。"}, "finish_reason": "stop"}], "upstreamEcho": credential}
        result = io.BytesIO(json.dumps(payload).encode())
        result.status = 200
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config-dir", required=True)
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    module.urllib.request.build_opener = lambda *args: SyntheticProvider()
    server = module.make_server(args.port, config_dir=args.config_dir)
    print(json.dumps({"port": server.server_port}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
