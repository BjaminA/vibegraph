from predict import predict


def test_predict_scales():
    result = predict(2.0)
    assert result > 0
