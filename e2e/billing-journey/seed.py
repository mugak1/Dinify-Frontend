"""Seed THREE restaurants, one owner each, for the D07/G2 billing journey.

Three because the portal scopes to the membership selected AT LOGIN, so
visiting three commercial situations means three sign-ins. Each owner sees
exactly one restaurant, which is also what keeps the three screens from
borrowing each other's state.

    unconfigured   no service configuration, no terms, no transactions.
                   The ordinary state of almost every restaurant today.
    legacy         the LEGACY BILLABLE shape and NOTHING canonical:
                   `subscription_validity=True`, a future
                   `subscription_expiry_date`, a `flat_fee` and a
                   `preferred_subscription_method`. This is precisely the row
                   that used to render "Active" and a next billing date, so it
                   is the fixture that proves those columns decide nothing now.
    recorded       canonical open `RestaurantSubscriptionTerms` plus a
                   subscription `DinifyTransaction` for the history table.

NOTHING HERE COLLECTS ANYTHING. The transaction row is a RECORD, seeded
directly; no provider is contacted, no OTP is issued and no collection is
attempted — the collector this journey exercises answers 501.
"""
import json
from decimal import Decimal
from datetime import timedelta

from django.utils import timezone

from users_app.models import User
from restaurants_app.models import Restaurant, RestaurantEmployee
from commercial_app.models import RestaurantSubscriptionTerms
from finance_app.models import DinifyTransaction
from dinify_backend.configss import string_definitions as sd

PASSWORD = 'billing-fixture-pw'
NOW = timezone.now()

SPECS = [
    ('unconfigured', '256700000801', 'Unconfigured Grill'),
    ('legacy', '256700000802', 'Legacy Billable Grill'),
    ('recorded', '256700000803', 'Recorded Terms Grill'),
]

fixture = {'password': PASSWORD, 'restaurants': {}}

for key, phone, name in SPECS:
    owner, _ = User.objects.get_or_create(
        username=phone,
        defaults=dict(phone_number=phone, first_name=key.title(), last_name='Owner',
                      email=f'{key}@example.com', country='UG'),
    )
    owner.set_password(PASSWORD)
    # `prompt_password_change` DEFAULTS True on every account this model
    # creates, which diverts login to the temporary-password screen. Cleared
    # here so the journey reaches the portal; it is a fixture convenience and
    # says nothing about the behaviour under test.
    owner.prompt_password_change = False
    owner.save()

    r, _ = Restaurant.objects.get_or_create(
        name=name, location='Kampala', owner=owner,
        defaults=dict(country='UG', accepting_orders=True),
    )
    r.status = sd.RestaurantStatus_Live
    r.save()

    membership, _ = RestaurantEmployee.objects.get_or_create(
        user=owner, restaurant=r, defaults=dict(roles=[sd.RESTAURANT_OWNER]),
    )
    membership.roles = [sd.RESTAURANT_OWNER]
    membership.active = True
    membership.deleted = False
    membership.save()

    fixture['restaurants'][key] = {
        'id': str(r.id), 'name': r.name, 'owner_phone': phone,
    }

# -- legacy billable: the shape that used to read "Active" --------------------
legacy = Restaurant.objects.get(id=fixture['restaurants']['legacy']['id'])
legacy.subscription_validity = True
legacy.subscription_expiry_date = NOW + timedelta(days=90)
legacy.flat_fee = Decimal('1500000.00')
legacy.preferred_subscription_method = 'monthly'
legacy.save()

# The unconfigured one is left with whatever the column DEFAULTS to, which is
# the point: `subscription_validity` defaults True with no supported writer, so
# even a restaurant nobody has ever billed carries a truthy legacy flag.
unconf = Restaurant.objects.get(id=fixture['restaurants']['unconfigured']['id'])
fixture['restaurants']['unconfigured']['legacy_validity'] = bool(
    unconf.subscription_validity)

# -- canonical recorded terms + one history row -------------------------------
recorded = Restaurant.objects.get(id=fixture['restaurants']['recorded']['id'])
RestaurantSubscriptionTerms.objects.filter(restaurant=recorded).delete()
# `recorded_by` is NOT NULL: terms are always attributable to the platform
# staff member who wrote them down. A disposable one is created here rather
# than reusing an owner — an owner recording their own price would misstate who
# decides it, even in a fixture.
recorder, _ = User.objects.get_or_create(
    username='256700000899',
    defaults=dict(phone_number='256700000899', first_name='Fixture',
                  last_name='Recorder', email='recorder@example.com', country='UG'),
)
terms = RestaurantSubscriptionTerms.objects.create(
    restaurant=recorded,
    recorded_by=recorder,
    # A NON-ZERO FRACTION, deliberately: the scale has to survive the wire and
    # the screen, and a round number cannot show that it did.
    recurring_amount=Decimal('150000.50'),
    currency='UGX',
    billing_interval_unit='month',
    billing_interval_count=1,
    effective_from=NOW - timedelta(days=30),
)
DinifyTransaction.objects.filter(restaurant=recorded).delete()
tx = DinifyTransaction.objects.create(
    restaurant=recorded,
    transaction_type=sd.TransactionType_Subscription,
    transaction_status=sd.TransactionStatus_Success,
    transaction_platform='web',
    transaction_amount=Decimal('150000.50'),
    payment_mode='momo',
)
fixture['restaurants']['recorded']['terms_id'] = str(terms.id)
fixture['restaurants']['recorded']['transaction_id'] = str(tx.id)
fixture['restaurants']['recorded']['amount'] = '150000.50'

print(json.dumps(fixture))
