"""Offline tests for merging the AT-SPI element list into a control observation."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("control", HERE / "control.py")
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


def reader_output(stdout):
    return patch.object(control.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout, ""))


class ReadUiElementsTest(unittest.TestCase):
    def test_lists_elements_and_truncation(self):
        lines = ['window "Editor"', '[push button] "Save" (10,20)']
        with reader_output(json.dumps({"elements": lines, "truncated": True})) as run:
            result = control.read_ui_elements(":1")
        self.assertEqual(result, {"elements": lines, "elementsTruncated": True})
        self.assertEqual(run.call_args.args[0], ["python3", "-I", control.UI_ELEMENTS_READER])
        self.assertEqual(run.call_args.kwargs["env"]["DISPLAY"], ":1")
        self.assertNotIn("RAKAZO_COMPUTER_CONTROL_TOKEN", run.call_args.kwargs["env"])

    def test_omits_empty_and_error_results(self):
        outputs = [
            json.dumps({"elements": [], "truncated": True}),
            json.dumps({"elements": [], "error": "x"}),
            "not json",
        ]
        for out in outputs:
            with reader_output(out):
                self.assertEqual(control.read_ui_elements(":1"), {})

    def test_timeout_is_swallowed(self):
        with patch.object(control.subprocess, "run", side_effect=subprocess.TimeoutExpired("x", 4)):
            self.assertEqual(control.read_ui_elements(":1"), {})


if __name__ == "__main__":
    unittest.main()
