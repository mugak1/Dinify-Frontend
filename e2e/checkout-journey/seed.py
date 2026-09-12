"""Seed ONE restaurant with a modifier+extras dish for the browser journey.

It also seeds the OWNER MEMBERSHIP and emits the owner's credentials, because
the journey now does two things only an authenticated operator can do: change a
dish price mid-run (so the review is proved to show the CURRENT server price
rather than anything the browser cached) and read the accepted order back off
the kitchen board. Both go through the real APIs rather than a shell.
"""
import json, uuid
from decimal import Decimal
from django.utils import timezone
from users_app.models import User
from restaurants_app.models import (
    Restaurant, MenuSection, MenuItem, Table, DiningArea, RestaurantEmployee,
)
from restaurants_app.controllers.diner_capability import issue_qr_credential
from dinify_backend.configss import string_definitions as sd

OWNER_PHONE = '256700000001'
OWNER_PASSWORD = 'journey-fixture-pw'

owner, _ = User.objects.get_or_create(
    username=OWNER_PHONE,
    defaults=dict(phone_number=OWNER_PHONE, first_name='Jo', last_name='Owner',
                  email='jo@example.com', country='UG'),
)
owner.set_password(OWNER_PASSWORD); owner.save()

r, _ = Restaurant.objects.get_or_create(
    name='Journey Grill', location='Kampala', owner=owner,
    defaults=dict(country='UG', accepting_orders=True),
)
r.status = sd.RestaurantStatus_Live
r.accepting_orders = True
r.save()

membership, _ = RestaurantEmployee.objects.get_or_create(
    user=owner, restaurant=r, defaults=dict(roles=[sd.RESTAURANT_OWNER]),
)
membership.roles = [sd.RESTAURANT_OWNER]
membership.active = True
membership.deleted = False
membership.save()

area, _ = DiningArea.objects.get_or_create(restaurant=r, name='Main')
t, created = Table.objects.get_or_create(
    restaurant=r, number=1, defaults=dict(dining_area=area, has_qr=True, enabled=True),
)
t.has_qr = True; t.enabled = True; t.save()

sec, _ = MenuSection.objects.get_or_create(
    restaurant=r, name='Mains', defaults=dict(approved=True, enabled=True, available=True),
)
sec.approved = True; sec.enabled = True; sec.available = True; sec.save()

OPTIONS = {
    'hasModifiers': True,
    'groups': [{
        'id': 'g-size', 'name': 'Size', 'selectionType': 'single',
        'minSelections': 1, 'maxSelections': 1,
        'choices': [
            {'id': 'c-reg', 'name': 'Regular', 'additionalCost': 0, 'available': True},
            {'id': 'c-large', 'name': 'Large', 'additionalCost': 3500, 'available': True},
        ],
    }],
}

cheese, _ = MenuItem.objects.get_or_create(
    section=sec, name='Extra Cheese',
    defaults=dict(section=sec, primary_price=Decimal('2000.00'), is_extra=True,
                  approved=True, enabled=True, available=True, in_stock=True),
)
for f, v in dict(section=sec, primary_price=Decimal('2000.00'), is_extra=True,
                 approved=True, enabled=True, available=True, in_stock=True).items():
    setattr(cheese, f, v)
cheese.save()

burger, _ = MenuItem.objects.get_or_create(
    section=sec, name='Signature Burger',
    defaults=dict(section=sec, primary_price=Decimal('10000.00')),
)
for f, v in dict(section=sec, primary_price=Decimal('10000.00'), approved=True,
                 enabled=True, available=True, in_stock=True, options=OPTIONS,
                 has_extras=True, extras_applicable=[str(cheese.id)],
                 # ONE applicable extra, so the maximum is ONE.
                 # `menu_relationships` validates the COMPLETE effective state on
                 # every write, so a maximum above the number of applicable extras
                 # makes the item unsavable through the real operator API — which
                 # the journey now uses to reprice it mid-run. The seed writes
                 # through the ORM and would not have noticed.
                 extras_min_selections=0, extras_max_selections=1).items():
    setattr(burger, f, v)
burger.save()

# THE SUB-CENT GOLDEN. `additionalCost` lives in an unvalidated JSON blob, so a
# third decimal place is genuinely storable there — and the money contract says
# each UNIT COMPONENT is quantized ONCE, at 2dp, ROUND_HALF_EVEN. 1.005 ties to
# EVEN and becomes 1.00; a round-half-up implementation anywhere in the chain
# produces 1.01 and the journey's expected total misses by a cent. Stored as
# STRINGS so the fixture states the exact decimal rather than whatever a float
# repr happens to carry.
ROUNDING_OPTIONS = {
    'hasModifiers': True,
    'groups': [{
        'id': 'g-round', 'name': 'Rounding', 'selectionType': 'single',
        'minSelections': 1, 'maxSelections': 1,
        'choices': [
            {'id': 'c-half-even-down', 'name': 'Half Even Down',
             'additionalCost': '1.005', 'available': True},
            {'id': 'c-half-even-up', 'name': 'Half Even Up',
             'additionalCost': '1.015', 'available': True},
        ],
    }],
}

# THE NONZERO-FRACTION GOLDEN is produced by the MID-RUN reprice rather than by
# a seeded price: the journey raises the burger to 12000.15 through the real
# operator API, so the parent unit is 12000.15 + 3500.00 = 15500.15 and the line
# is exactly 2 x that, 31000.30. It is a DIFFERENT control from the sub-cent one
# below — that proves half-even ties, this proves a real fractional amount
# survives extension, formatting and the wire without becoming 31000.299999.

rounding, _ = MenuItem.objects.get_or_create(
    section=sec, name='Rounding Test',
    defaults=dict(section=sec, primary_price=Decimal('10.00')),
)
for f, v in dict(section=sec, primary_price=Decimal('10.00'), approved=True,
                 enabled=True, available=True, in_stock=True,
                 options=ROUNDING_OPTIONS, has_extras=False,
                 extras_applicable=[], extras_min_selections=0,
                 extras_max_selections=0).items():
    setattr(rounding, f, v)
rounding.save()

print(json.dumps({
    'restaurant': str(r.id), 'table': str(t.id), 'table_number': t.number,
    'burger': str(burger.id), 'cheese': str(cheese.id),
    'rounding': str(rounding.id),
    'credential': issue_qr_credential(str(r.id), str(t.id), t.qr_version),
    # The operator the journey reprices and reads the kitchen board as. A
    # DISPOSABLE FIXTURE ACCOUNT on a disposable database — never a real one.
    'operator': {'username': OWNER_PHONE, 'password': OWNER_PASSWORD},
}))
