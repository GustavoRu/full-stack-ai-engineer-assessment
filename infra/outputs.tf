output "url" {
  description = "Address of the application"
  value       = "http://${aws_lb.main.dns_name}"
}

output "ecr_repositories" {
  description = "Where to push the two images"
  value = {
    api = aws_ecr_repository.api.repository_url
    web = aws_ecr_repository.web.repository_url
  }
}

output "secrets_to_fill" {
  description = "Secrets whose values must be set by hand before the first deployment"
  value = [
    aws_secretsmanager_secret.gemini_api_key.name,
    aws_secretsmanager_secret.jwt_secret.name,
  ]
}
