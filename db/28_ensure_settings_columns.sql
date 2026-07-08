-- ADRIA — يضمن وجود كل أعمدة إعدادات المتجر (تسميات الدفع، طرق 5/6، ...).
-- آمن للتشغيل أكثر من مرة. شغّله لو تسميات المحافظ/الإعدادات مش بتتحفظ.
--
-- السبب: حفظ الإعدادات بيبعت كل الأعمدة مرة واحدة، فلو أي عمود ناقص
-- بيفشل الحفظ كله (بما فيه تسميات المحافظ). ده بيضيف الناقص بأمان.

alter table store_settings add column if not exists payment_labels                jsonb;
alter table store_settings add column if not exists payment_methods_enabled       jsonb;
alter table store_settings add column if not exists show_invoice_profit           boolean default true;
alter table store_settings add column if not exists allow_cashier_employee_advance boolean default false;
alter table store_settings add column if not exists cashier_permissions           jsonb;
alter table store_settings add column if not exists initial_balance               numeric default 0;
alter table store_settings add column if not exists location_url                  text;
alter table store_settings add column if not exists phone2                        text;
alter table store_settings add column if not exists whatsapp_country_code         text;
alter table store_settings add column if not exists address                       text;
alter table store_settings add column if not exists tax_rate                      numeric default 0;
alter table store_settings add column if not exists theme_color                   text;
alter table store_settings add column if not exists day_start_hour                integer default 3;
