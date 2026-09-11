"""Seed ONE restaurant with a modifier+extras dish for the browser journey."""
import json, uuid
from decimal import Decimal
from django.utils import timezone
from users_app.models import User
from restaurants_app.models import Restaurant, MenuSection, MenuItem, Table, DiningArea
from restaurants_app.controllers.diner_capability import issue_qr_credential
from dinify_backend.configss import string_definitions as sd

owner, _ = User.objects.get_or_create(
    username='256700000001',
    defaults=dict(phone_number='256700000001', first_name='Jo', last_name='Owner',
                  email='jo@example.com', country='UG'),
)
owner.set_password('x'); owner.save()

r, _ = Restaurant.objects.get_or_create(
    name='Journey Grill', location='Kampala', owner=owner,
    defaults=dict(country='UG', accepting_orders=True),
)
r.status = sd.RestaurantStatus_Live
r.accepting_orders = True
r.save()

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
                 extras_min_selections=0, extras_max_selections=2).items():
    setattr(burger, f, v)
burger.save()

print(json.dumps({
    'restaurant': str(r.id), 'table': str(t.id), 'table_number': t.number,
    'burger': str(burger.id), 'cheese': str(cheese.id),
    'credential': issue_qr_credential(str(r.id), str(t.id), t.qr_version),
}))
