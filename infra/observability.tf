resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.project}/api"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${var.project}/web"
  retention_in_days = var.log_retention_days
}

# The API writes one JSON object per line, so metrics come from fields, not text matching.
# Grafana or CloudWatch dashboards read these metrics and the audit table in PostgreSQL.

resource "aws_cloudwatch_log_metric_filter" "questions_answered" {
  name           = "${var.project}-questions-answered"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.message.event = \"question_answered\" }"

  metric_transformation {
    name      = "QuestionsAnswered"
    namespace = "DocQA"
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "question_failures" {
  name           = "${var.project}-question-failures"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.message.event = \"question_failed\" }"

  metric_transformation {
    name      = "QuestionFailures"
    namespace = "DocQA"
    value     = "1"
  }
}

# Token usage is what the provider bills, so it is tracked as its own metric
resource "aws_cloudwatch_log_metric_filter" "output_tokens" {
  name           = "${var.project}-output-tokens"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.message.event = \"question_answered\" }"

  metric_transformation {
    name      = "OutputTokens"
    namespace = "DocQA"
    value     = "$.message.outputTokens"
  }
}

resource "aws_cloudwatch_metric_alarm" "question_failures" {
  alarm_name          = "${var.project}-question-failures"
  alarm_description   = "More than 5 failed questions in 5 minutes: provider outage, quota or a bad prompt version"
  namespace           = "DocQA"
  metric_name         = "QuestionFailures"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}
