import pandas as pd
import pytest

from train_model import marginal_probs, remap_to_contiguous


def test_probs_follow_their_code_not_their_size():
    # Code 1 is the rare answer and code 3 the common one; sorting by size would swap them.
    col = pd.Series([1] + [2] * 3 + [3] * 6)
    _, sorted_codes = remap_to_contiguous(col)
    assert sorted_codes == [1, 2, 3]
    assert marginal_probs(col, sorted_codes) == pytest.approx([0.1, 0.3, 0.6])
