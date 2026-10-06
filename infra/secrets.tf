# Terraform creates the secrets but not their values. The values are set out of
# band, so they never reach the repository, the variables or the state:
#   aws secretsmanager put-secret-value --secret-id docqa/gemini-api-key --secret-string "..."

resource "aws_secretsmanager_secret" "gemini_api_key" {
  name        = "${var.project}/gemini-api-key"
  description = "API key of the LLM provider"
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name        = "${var.project}/jwt-secret"
  description = "Signing secret for access tokens"
}
