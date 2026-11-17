#!/bin/bash
# Topologia local (LocalStack) só do que este serviço publica e consome.
set -euo pipefail

awslocal sns create-topic --name lagoski-dev-ordering-events >/dev/null
awslocal sns create-topic --name lagoski-dev-catalog-events >/dev/null
awslocal sns create-topic --name lagoski-dev-inventory-events >/dev/null
awslocal sns create-topic --name lagoski-dev-payment-events >/dev/null
awslocal sns create-topic --name lagoski-dev-fulfillment-events >/dev/null
awslocal sqs create-queue --queue-name lagoski-dev-ordering-on-catalog-dlq >/dev/null
awslocal sqs create-queue --queue-name lagoski-dev-ordering-on-catalog --attributes '{"RedrivePolicy":"{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:lagoski-dev-ordering-on-catalog-dlq\",\"maxReceiveCount\":\"5\"}"}' >/dev/null
awslocal sns subscribe --topic-arn arn:aws:sns:us-east-1:000000000000:lagoski-dev-catalog-events --protocol sqs --notification-endpoint arn:aws:sqs:us-east-1:000000000000:lagoski-dev-ordering-on-catalog --attributes '{"RawMessageDelivery":"true","FilterPolicyScope":"MessageAttributes","FilterPolicy":"{\"ce_type\":[\"lagoski.catalog.product.published.v1\",\"lagoski.catalog.variant.price-changed.v1\",\"lagoski.catalog.product.discontinued.v1\"]}"}' >/dev/null
awslocal sqs create-queue --queue-name lagoski-dev-ordering-on-inventory-dlq >/dev/null
awslocal sqs create-queue --queue-name lagoski-dev-ordering-on-inventory --attributes '{"RedrivePolicy":"{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:lagoski-dev-ordering-on-inventory-dlq\",\"maxReceiveCount\":\"5\"}"}' >/dev/null
awslocal sns subscribe --topic-arn arn:aws:sns:us-east-1:000000000000:lagoski-dev-inventory-events --protocol sqs --notification-endpoint arn:aws:sqs:us-east-1:000000000000:lagoski-dev-ordering-on-inventory --attributes '{"RawMessageDelivery":"true","FilterPolicyScope":"MessageAttributes","FilterPolicy":"{\"ce_type\":[\"lagoski.inventory.stock.reserved.v1\",\"lagoski.inventory.stock.reservation-rejected.v1\",\"lagoski.inventory.reservation.expired.v1\"]}"}' >/dev/null
awslocal sqs create-queue --queue-name lagoski-dev-ordering-on-payment-dlq >/dev/null
awslocal sqs create-queue --queue-name lagoski-dev-ordering-on-payment --attributes '{"RedrivePolicy":"{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:lagoski-dev-ordering-on-payment-dlq\",\"maxReceiveCount\":\"5\"}"}' >/dev/null
awslocal sns subscribe --topic-arn arn:aws:sns:us-east-1:000000000000:lagoski-dev-payment-events --protocol sqs --notification-endpoint arn:aws:sqs:us-east-1:000000000000:lagoski-dev-ordering-on-payment --attributes '{"RawMessageDelivery":"true","FilterPolicyScope":"MessageAttributes","FilterPolicy":"{\"ce_type\":[\"lagoski.payment.payment.requested.v1\",\"lagoski.payment.payment.authorized.v1\",\"lagoski.payment.payment.declined.v1\"]}"}' >/dev/null
awslocal sqs create-queue --queue-name lagoski-dev-ordering-on-fulfillment-dlq >/dev/null
awslocal sqs create-queue --queue-name lagoski-dev-ordering-on-fulfillment --attributes '{"RedrivePolicy":"{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:lagoski-dev-ordering-on-fulfillment-dlq\",\"maxReceiveCount\":\"5\"}"}' >/dev/null
awslocal sns subscribe --topic-arn arn:aws:sns:us-east-1:000000000000:lagoski-dev-fulfillment-events --protocol sqs --notification-endpoint arn:aws:sqs:us-east-1:000000000000:lagoski-dev-ordering-on-fulfillment --attributes '{"RawMessageDelivery":"true","FilterPolicyScope":"MessageAttributes","FilterPolicy":"{\"ce_type\":[\"lagoski.fulfillment.shipment.dispatched.v1\",\"lagoski.fulfillment.shipment.delivered.v1\"]}"}' >/dev/null
touch /tmp/lagoski-ready
echo "topologia Lagoski pronta"
