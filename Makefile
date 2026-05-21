.PHONY: install build test bootstrap deploy destroy

# AWS profile for all deployment targets. Override with: make deploy AWS_PROFILE=other
AWS_PROFILE ?= personal

install:
	npm install
	npm install --prefix infra

build:
	npm run build
	npm run build --prefix infra

test:
	npm test

# One-time per account: bootstrap CDK in eu-west-1
bootstrap:
	@ACCOUNT=$$(AWS_PROFILE=$(AWS_PROFILE) aws sts get-caller-identity --query Account --output text); \
	echo "Bootstrapping account $$ACCOUNT (profile: $(AWS_PROFILE))"; \
	cd infra && AWS_PROFILE=$(AWS_PROFILE) npx cdk bootstrap aws://$$ACCOUNT/eu-west-1

# Deploy the announcer stack. Reads .env from project root via infra/bin/app.ts.
deploy:
	cd infra && AWS_PROFILE=$(AWS_PROFILE) npx cdk deploy --require-approval never

destroy:
	cd infra && AWS_PROFILE=$(AWS_PROFILE) npx cdk destroy
