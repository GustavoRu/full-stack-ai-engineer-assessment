resource "aws_lb" "main" {
  name               = var.project
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  # A question can take up to about 96 s: three attempts of 30 s each plus waits
  idle_timeout = 120
}

resource "aws_lb_target_group" "api" {
  name        = "${var.project}-api"
  port        = 3001
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  deregistration_delay = 30

  health_check {
    path              = "/api/health"
    matcher           = "200"
    interval          = 15
    healthy_threshold = 2
  }
}

resource "aws_lb_target_group" "web" {
  name        = "${var.project}-web"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  deregistration_delay = 30

  health_check {
    path              = "/login"
    matcher           = "200"
    interval          = 15
    healthy_threshold = 2
  }
}

# HTTP only: there is no domain, so no certificate. Production adds an HTTPS
# listener with an ACM certificate and redirects port 80 to it.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# One host serves both, so the browser calls the API on the same origin and needs no CORS
resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}
