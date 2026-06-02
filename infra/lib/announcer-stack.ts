import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as path from 'path';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';

export interface TokenDerbySlackAnnouncerStackProps extends cdk.StackProps {
  webhookSecret: string;
  slackBotToken: string;
  slackChannelId: string;
  tokenDerbyOrgName: string;
  tokenDerbyApiBase?: string;
}

export class TokenDerbySlackAnnouncerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TokenDerbySlackAnnouncerStackProps) {
    super(scope, id, props);

    // Public S3 bucket for sprite PNGs. Content-addressed keys, immutable.
    const spriteBucket = new s3.Bucket(this, 'SpriteBucket', {
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    spriteBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      principals: [new iam.AnyPrincipal()],
      resources: [spriteBucket.arnForObjects('winners/*')],
    }));

    const fn = new NodejsFunction(this, 'AnnouncerFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.resolve(__dirname, '..', '..', 'src', 'handler.ts'),
      projectRoot: path.resolve(__dirname, '..', '..'),
      depsLockFilePath: path.resolve(__dirname, '..', '..', 'package-lock.json'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(5),
      memorySize: 256,
      bundling: {
        target: 'node22',
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      environment: {
        WEBHOOK_SECRET:    props.webhookSecret,
        SLACK_BOT_TOKEN:   props.slackBotToken,
        SLACK_CHANNEL_ID:  props.slackChannelId,
        SPRITE_BUCKET:     spriteBucket.bucketName,
        NODE_OPTIONS:      '--enable-source-maps',
      },
    });

    spriteBucket.grantReadWrite(fn);

    const weeklyFn = new NodejsFunction(this, 'WeeklyAnnouncerFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.resolve(__dirname, '..', '..', 'src', 'weekly.ts'),
      projectRoot: path.resolve(__dirname, '..', '..'),
      depsLockFilePath: path.resolve(__dirname, '..', '..', 'package-lock.json'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      bundling: {
        target: 'node22',
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      environment: {
        SLACK_BOT_TOKEN:       props.slackBotToken,
        SLACK_CHANNEL_ID:      props.slackChannelId,
        TOKEN_DERBY_ORG_NAME:  props.tokenDerbyOrgName,
        ...(props.tokenDerbyApiBase ? { TOKEN_DERBY_API_BASE: props.tokenDerbyApiBase } : {}),
        NODE_OPTIONS:          '--enable-source-maps',
      },
    });

    // Role EventBridge Scheduler assumes to invoke the weekly function.
    const schedulerRole = new iam.Role(this, 'WeeklySchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    });
    weeklyFn.grantInvoke(schedulerRole);

    // Friday 15:00 Europe/London (DST-aware via EventBridge Scheduler).
    new scheduler.CfnSchedule(this, 'WeeklyLeaderboardSchedule', {
      flexibleTimeWindow: { mode: 'OFF' },
      scheduleExpression: 'cron(0 15 ? * FRI *)',
      scheduleExpressionTimezone: 'Europe/London',
      target: {
        arn: weeklyFn.functionArn,
        roleArn: schedulerRole.roleArn,
        retryPolicy: { maximumRetryAttempts: 2 },
      },
    });

    const httpApi = new HttpApi(this, 'AnnouncerApi', { apiName: 'token-derby-slack-announcer' });
    httpApi.addRoutes({
      path: '/webhook',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('WebhookInt', fn),
    });

    new cdk.CfnOutput(this, 'WebhookUrl', { value: `${httpApi.url}webhook` });
    new cdk.CfnOutput(this, 'SpriteBucketName', { value: spriteBucket.bucketName });
  }
}
