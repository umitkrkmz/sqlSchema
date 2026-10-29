/*
 * Çekirdek bankacılık — SQL Server, SSMS "Generate Scripts" çıktısı.
 * UTF-16 (BOM'lu) kodlama, GO ayraçları, [köşeli] adlar, IDENTITY, açıklamalar sp_addextendedproperty ile.
 * Bazı yüksek hacimli tablolar (işlem, oturum, denetim) FK'siz; AML alarmı işleme yalnızca adla bağlı.
 */
'use strict';

const SPEC = `
ref.Currency | Para birimi | CurrencyCode:char(3) pk; Name:str(50) nn; MinorUnit:int nn
ref.Country | | CountryId:int pk ai; Iso2:char(2) nn uq; Name:str(100) nn
ref.City | | CityId:int pk ai; CountryId:int nn >Country; Name:str(100) nn; PlateCode:char(2)
ref.Region | Bölge müdürlüğü | RegionId:int pk ai; Name:str(100) nn; ManagerEmployeeId >sec.Employee
ref.Branch | Şube | BranchId:int pk ai; BranchCode:str(10) nn uq; Name:str(100) nn; CityId:int nn >City; RegionId:int >Region; OpenedOn:date
ref.Holiday | | HolidayDate:date pk; CountryId:int pk >Country; Name:str(100)
ref.TaxOffice | Vergi dairesi | TaxOfficeId:int pk ai; Name:str(100) nn; CityId:int >City
ref.Occupation | Meslek | OccupationId:int pk ai; Name:str(150) nn; RiskLevel:int
ref.Sector | Faaliyet sektörü (NACE) | SectorId:int pk ai; NaceCode:str(10) nn uq; Name:str(200) nn

cust.Customer | Gerçek / tüzel müşteri ana kaydı | CustomerId pk ai; CustomerNo:str(20) nn uq; CustomerTypeId:int nn >ref.CustomerType; SegmentId:int >ref.CustomerSegment; HomeBranchId:int nn >ref.Branch; RiskGroupId >RiskGroup; StatusId:int nn >ref.CustomerStatus; OnboardedAt:ts nn; ClosedAt:ts
cust.Person | Gerçek kişi (Customer ile 1:1) | CustomerId pk >Customer; NationalId:char(11) nn uq; FirstName:str(100) nn; LastName:str(100) nn; BirthDate:date nn; BirthPlace:str(100); MotherName:str(100); FatherName:str(100); Gender:char(1); NationalityId:int >ref.Country; MaritalStatusId:int >ref.MaritalStatus; EducationLevelId:int >ref.EducationLevel; OccupationId:int >ref.Occupation
cust.Company | Tüzel kişi (Customer ile 1:1) | CustomerId pk >Customer; TaxNo:char(10) nn uq; TradeName:str(250) nn; TaxOfficeId:int >ref.TaxOffice; TradeRegistryNo:str(30); FoundedOn:date; SectorId:int >ref.Sector; EmployeeCount:int; AnnualTurnover:money
cust.CompanyAuthority | Şirket yetkilileri (imza sirküleri) | CompanyAuthorityId pk ai; CompanyCustomerId nn >Company; PersonCustomerId nn >Person; AuthorityTypeId:int nn >ref.AuthorityType; ValidFrom:date nn; ValidTo:date; SignatureCircularRef:str(50)
cust.Address | | AddressId pk ai; CustomerId nn >Customer; AddressTypeId:int nn >ref.AddressType; CityId:int nn >ref.City; District:str(100); Line1:str(250) nn; PostalCode:str(10); IsPrimary:bool nn
cust.Contact | | ContactId pk ai; CustomerId nn >Customer; ContactTypeId:int nn >ref.ContactType; Value:str(200) nn; IsVerified:bool nn; VerifiedAt:ts
cust.KycProfile | Müşterini tanı (KYC) profili | CustomerId pk >Customer; RiskScore:dec(5,2); IncomeRangeId:int >ref.IncomeRange; SourceOfFundsId:int >ref.FundSourceType; PepFlag:bool nn; LastReviewedAt:ts; NextReviewOn:date
cust.KycDocument | | KycDocumentId pk ai; CustomerId nn >Customer; DocumentTypeId:int nn >ref.DocumentType; DocumentNo:str(50); IssuedOn:date; ExpiresOn:date; StoragePath:str(400); VerifiedByEmployeeId >sec.Employee
cust.RiskGroup | Kredi riski grubu | RiskGroupId pk ai; Name:str(200) nn; GroupLimit:money
cust.CustomerRelation | | CustomerRelationId pk ai; CustomerId nn >Customer; RelatedCustomerId nn >Customer; RelationTypeId:int nn >ref.RelationType
cust.Consent | KVKK / İYS izinleri | ConsentId pk ai; CustomerId nn >Customer; ConsentTypeId:int nn >ref.ConsentType; ChannelId:int >ref.Channel; IsGranted:bool nn; GrantedAt:ts nn; RevokedAt:ts

acc.Product | Mevduat / hesap ürünleri | ProductId:int pk ai; ProductCode:str(20) nn uq; Name:str(150) nn; AccountTypeId:int nn >ref.AccountType; CurrencyCode:char(3) >ref.Currency; InterestRate:dec(9,6); IsActive:bool nn
acc.Account | Hesap | AccountId pk ai; Iban:char(26) nn uq; AccountNo:str(20) nn; CustomerId nn >cust.Customer; ProductId:int nn >Product; BranchId:int nn >ref.Branch; CurrencyCode:char(3) nn >ref.Currency; StatusId:int nn >ref.AccountStatus; OpenedAt:ts nn; ClosedAt:ts; OverdraftLimit:money
acc.AccountHolder | Ortak hesap sahipleri | AccountId pk >Account; CustomerId pk >cust.Customer; HolderRoleId:int nn >ref.HolderRole
acc.Balance | Anlık bakiye (Account ile 1:1) | AccountId pk >Account; LedgerBalance:money nn; AvailableBalance:money nn; BlockedAmount:money nn; BalanceUpdatedAt:ts nn
acc.Transaction +part | Hesap hareketleri; hacim nedeniyle ödeme emrine FK yok | TransactionId pk ai; AccountId nn >Account; TransactionTypeId:int nn >ref.TransactionType; Amount:money nn; CurrencyCode:char(3) nn >ref.Currency; ValueDate:date nn; BookingDate:date nn; Description:str(250); ChannelId:int >ref.Channel; ReferenceNo:str(40); ReversalOfTransactionId >Transaction; PaymentOrderId
acc.Block | Hesap blokesi (haciz, teminat) | BlockId pk ai; AccountId nn >Account; BlockReasonId:int nn >ref.BlockReason; Amount:money nn; PlacedAt:ts nn; ReleasedAt:ts; LegalOrderNo:str(50)
acc.TermDeposit | Vadeli mevduat | AccountId pk >Account; MaturityDate:date nn; InterestRate:dec(9,6) nn; AutoRenew:bool nn; PrincipalAmount:money nn
acc.StandingOrder | Düzenli ödeme talimatı | StandingOrderId pk ai; AccountId nn >Account; BeneficiaryIban:char(26) nn; Amount:money nn; FrequencyTypeId:int nn >ref.FrequencyType; NextRunOn:date; EndsOn:date
acc.Statement | Hesap ekstresi | StatementId pk ai; AccountId nn >Account; PeriodStart:date nn; PeriodEnd:date nn; GeneratedAt:ts nn; DeliveryChannelId:int >ref.Channel

card.CardProduct | | CardProductId:int pk ai; Name:str(100) nn; CardSchemeTypeId:int nn >ref.CardSchemeType; IsCredit:bool nn; AnnualFee:money
card.Card | Kart (kart numarası tutulmaz, yalnızca token) | CardId pk ai; CardToken:str(64) nn uq; MaskedPan:char(19) nn; CustomerId nn >cust.Customer; AccountId >acc.Account; CardProductId:int nn >CardProduct; StatusId:int nn >ref.CardStatus; IssuedAt:ts nn; ExpiresOn:date nn; ReplacedByCardId >Card
card.CreditCardAccount | | CreditCardAccountId pk ai; CustomerId nn >cust.Customer; CreditLimit:money nn; CycleDay:int nn; MinPaymentRate:dec(5,2) nn; StatusId:int nn >ref.AccountStatus
card.CardLimit | | CardId pk >Card; DailyAtmLimit:money; DailyPosLimit:money; OnlineEnabled:bool nn; AbroadEnabled:bool nn
card.Merchant | Üye işyeri | MerchantId pk ai; MerchantNo:str(20) nn uq; Name:str(200) nn; Mcc:char(4) nn; CustomerId >cust.Customer; CityId:int >ref.City
card.Authorization +part | POS / ATM provizyon kayıtları | AuthorizationId pk ai; CardId nn >Card; MerchantId >Merchant; Amount:money nn; CurrencyCode:char(3) nn >ref.Currency; ResponseCode:char(2) nn; AuthorizedAt:ts nn; Mcc:char(4)
card.CardStatement | Kredi kartı ekstresi | CardStatementId pk ai; CreditCardAccountId nn >CreditCardAccount; StatementDate:date nn; DueDate:date nn; TotalDue:money nn; MinimumDue:money nn
card.Installment | Taksitli işlem | InstallmentId pk ai; AuthorizationId nn >Authorization; InstallmentCount:int nn; InstallmentNo:int nn; Amount:money nn; CardStatementId >CardStatement
card.Dispute | Harcama itirazı | DisputeId pk ai; AuthorizationId nn >Authorization; DisputeReasonId:int nn >ref.DisputeReason; OpenedAt:ts nn; ResolvedAt:ts; ChargebackAmount:money

pay.Bank | | BankId:int pk ai; EftCode:char(5) nn uq; Name:str(200) nn; SwiftCode:str(11)
pay.PaymentOrder | Havale / EFT / FAST emri | PaymentOrderId pk ai; DebitAccountId nn >acc.Account; BeneficiaryName:str(200) nn; BeneficiaryIban:char(26) nn; Amount:money nn; CurrencyCode:char(3) nn >ref.Currency; PaymentTypeId:int nn >ref.PaymentType; StatusId:int nn >ref.PaymentStatus; ChannelId:int >ref.Channel; OrderedAt:ts nn; ExecutedAt:ts; ExternalRef:str(40)
pay.Beneficiary | Kayıtlı alıcı | BeneficiaryId pk ai; CustomerId nn >cust.Customer; Name:str(200) nn; Iban:char(26) nn; BankId:int >Bank
pay.SwiftMessage | | SwiftMessageId pk ai; PaymentOrderId >PaymentOrder; MessageType:str(10) nn; Direction:char(1) nn; Payload:text nn; ReceivedAt:ts nn
pay.Biller | Kurum (fatura tahsilatı) | BillerId:int pk ai; Name:str(200) nn; BillerCategoryId:int nn >ref.BillerCategory
pay.BillPayment | Fatura ödemesi | BillPaymentId pk ai; AccountId nn >acc.Account; BillerId:int nn >Biller; SubscriberNo:str(50) nn; Amount:money nn; PaidAt:ts nn
pay.QrPayment | Karekod ödeme | QrPaymentId pk ai; PaymentOrderId nn >PaymentOrder; QrPayload:str(500) nn; MerchantId >card.Merchant

loan.LoanProduct | | LoanProductId:int pk ai; Name:str(150) nn; LoanTypeId:int nn >ref.LoanType; MaxTermMonths:int nn; BaseRate:dec(9,6) nn
loan.Application | Kredi başvurusu | ApplicationId pk ai; CustomerId nn >cust.Customer; LoanProductId:int nn >LoanProduct; RequestedAmount:money nn; TermMonths:int nn; StatusId:int nn >ref.ApplicationStatus; ChannelId:int >ref.Channel; SubmittedAt:ts nn; DecidedAt:ts; DecidedByEmployeeId >sec.Employee
loan.CreditScore | Kredi bürosu skoru | CreditScoreId pk ai; ApplicationId nn >Application; Bureau:str(20) nn; Score:int nn; ReportRef:str(50); QueriedAt:ts nn
loan.Loan | Kullandırılan kredi | LoanId pk ai; ApplicationId nn uq >Application; AccountId nn >acc.Account; PrincipalAmount:money nn; InterestRate:dec(9,6) nn; DisbursedAt:ts nn; MaturityDate:date nn; StatusId:int nn >ref.LoanStatus
loan.RepaymentSchedule | Ödeme planı | LoanId pk >Loan; InstallmentNo:int pk; DueDate:date nn; Principal:money nn; Interest:money nn; Tax:money nn; PaidAt:ts
loan.Collateral | Teminat | CollateralId pk ai; LoanId nn >Loan; CollateralTypeId:int nn >ref.CollateralType; AppraisedValue:money; Description:str(400)
loan.Guarantor | Kefil | LoanId pk >Loan; CustomerId pk >cust.Customer; GuaranteeAmount:money nn
loan.Restructuring | Yapılandırma | RestructuringId pk ai; LoanId nn >Loan; NewLoanId >Loan; RestructuringReasonId:int >ref.RestructuringReason; ApprovedAt:ts
loan.Delinquency | Gecikme takibi | DelinquencyId pk ai; LoanId nn >Loan; DaysPastDue:int nn; Bucket:str(10) nn; CalculatedOn:date nn

aml.Rule | Senaryo kuralı | RuleId:int pk ai; Code:str(30) nn uq; Description:str(400); Threshold:money; IsActive:bool nn
aml.Alert | Şüpheli işlem alarmı | AlertId pk ai; CustomerId nn >cust.Customer; RuleId:int nn >Rule; TransactionId; ScoreValue:dec(6,2); StatusId:int nn >ref.AlertStatus; RaisedAt:ts nn; AssignedEmployeeId >sec.Employee
aml.Case | MASAK vaka dosyası | CaseId pk ai; CustomerId nn >cust.Customer; OpenedAt:ts nn; ClosedAt:ts; ReportedToRegulator:bool nn; ReportRef:str(50)
aml.CaseAlert | | CaseId pk >Case; AlertId pk >Alert
aml.SanctionList | Yaptırım listeleri (OFAC, BM, AB) | SanctionListId:int pk ai; Source:str(50) nn; Name:str(300) nn; ListedOn:date
aml.Screening | Liste taraması | ScreeningId pk ai; CustomerId nn >cust.Customer; SanctionListId:int >SanctionList; MatchScore:dec(5,2) nn; ScreenedAt:ts nn; Decision:str(20)

gl.LedgerAccount | Muhasebe hesap planı | LedgerAccountId:int pk ai; AccountCode:str(20) nn uq; Name:str(200) nn; ParentLedgerAccountId:int >LedgerAccount
gl.JournalEntry | | JournalEntryId pk ai; EntryDate:date nn; SourceSystem:str(20) nn; Description:str(250); PostedAt:ts
gl.JournalLine | | JournalEntryId pk >JournalEntry; LineNo:int pk; LedgerAccountId:int nn >LedgerAccount; BranchId:int >ref.Branch; Debit:money nn; Credit:money nn; CurrencyCode:char(3) >ref.Currency
gl.DailyBalance | | LedgerAccountId:int pk >LedgerAccount; BranchId:int pk >ref.Branch; BalanceDate:date pk; Balance:money nn

chan.DigitalUser | İnternet / mobil şube kullanıcısı | DigitalUserId pk ai; CustomerId nn uq >cust.Customer; Username:str(50) nn uq; LastLoginAt:ts; IsLocked:bool nn
chan.Device | Güvenilir cihaz | DeviceId pk ai; DigitalUserId nn >DigitalUser; DeviceFingerprint:str(128) nn; Platform:str(20); TrustedAt:ts
chan.Session +part | | SessionId:uuid pk; DigitalUserId nn >DigitalUser; DeviceId >Device; StartedAt:ts nn; EndedAt:ts; IpAddress:str(45)
chan.OtpLog +part | | OtpLogId pk ai; DigitalUserId nn >DigitalUser; Purpose:str(30) nn; SentAt:ts nn; VerifiedAt:ts
chan.Atm | | AtmId:int pk ai; TerminalId:str(16) nn uq; BranchId:int >ref.Branch; Latitude:dec(9,6); Longitude:dec(9,6)
chan.AtmTransaction +part | | AtmTransactionId pk ai; AtmId:int nn >Atm; CardId >card.Card; Amount:money nn; OccurredAt:ts nn

sec.Role | | RoleId:int pk ai; Name:str(100) nn uq
sec.Employee | Personel | EmployeeId pk ai; RegistryNo:str(20) nn uq; FullName:str(200) nn; BranchId:int >ref.Branch; ManagerEmployeeId >Employee; RoleId:int >Role
sec.Permission | | PermissionId:int pk ai; Code:str(100) nn uq
sec.RolePermission | | RoleId:int pk >Role; PermissionId:int pk >Permission
sec.AuditLog +part | Denetim izi (FK yok) | AuditLogId pk ai; EmployeeId; Action:str(50) nn; Entity:str(100) nn; EntityKey:str(100); OccurredAt:ts nn
`;

const EXTRA = `ALTER TABLE [cust].[Person]  WITH CHECK ADD  CONSTRAINT [CK_Person_Gender] CHECK  (([Gender]='F' OR [Gender]='M' OR [Gender]='U'))
GO
ALTER TABLE [cust].[Person] CHECK CONSTRAINT [CK_Person_Gender]
GO
/****** Object:  View [acc].[vw_CustomerBalance]    Script Date: 24.10.2026 09:41:17 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE VIEW [acc].[vw_CustomerBalance] AS
SELECT a.CustomerId, a.CurrencyCode, SUM(b.AvailableBalance) AS AvailableBalance
FROM acc.Account a JOIN acc.Balance b ON b.AccountId = a.AccountId
GROUP BY a.CustomerId, a.CurrencyCode;
GO
/****** Object:  StoredProcedure [pay].[usp_ExecutePaymentOrder]    Script Date: 24.10.2026 09:41:17 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE PROCEDURE [pay].[usp_ExecutePaymentOrder] @PaymentOrderId bigint
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRAN;
  UPDATE pay.PaymentOrder SET StatusId = 3, ExecutedAt = SYSUTCDATETIME() WHERE PaymentOrderId = @PaymentOrderId;
  INSERT INTO acc.[Transaction] (AccountId, TransactionTypeId, Amount, CurrencyCode, ValueDate, BookingDate, PaymentOrderId)
  SELECT DebitAccountId, 2, -Amount, CurrencyCode, CAST(GETDATE() AS date), CAST(GETDATE() AS date), PaymentOrderId FROM pay.PaymentOrder WHERE PaymentOrderId = @PaymentOrderId;
  COMMIT;
END
GO`;

const COMMENTS = { Iban: 'TR ile başlayan 26 karakter', NationalId: 'T.C. kimlik numarası', CardToken: 'Ödeme kuruluşu tokenı; kart numarası saklanmaz', MaskedPan: 'İlk 6 ve son 4 hane açık' };

module.exports = {
  id: 'banka',
  title: 'Çekirdek bankacılık',
  sector: 'Bankacılık',
  dialect: 'SQL Server',
  scenario: 'SSMS "Generate Scripts" çıktısı: UTF-16 kodlama, GO ayraçları, IDENTITY, açıklamalar sp_addextendedproperty ile; yüksek hacimli tablolar FK\'siz.',
  en: { title: 'Core banking', sector: 'Banking', scenario: 'SSMS "Generate Scripts" output: UTF-16 encoding, GO separators, IDENTITY, descriptions via sp_addextendedproperty; high-volume tables without FKs.' },
  build(lib) {
    const t = lib.parseSpec(SPEC);
    lib.addLookups(t, lib.PASCAL_LOOKUP);
    lib.addAudit(t, [
      { name: 'CreatedAt', type: 'ts', nn: true, def: '(sysutcdatetime())' },
      { name: 'CreatedBy', type: 'str(50)', nn: true, def: '(suser_sname())' },
      { name: 'UpdatedAt', type: 'ts' },
      { name: 'UpdatedBy', type: 'str(50)' },
      { name: 'RowVersion', type: '[timestamp]', nn: true },
    ]);
    for (const x of t.values()) for (const c of x.cols) if (COMMENTS[c.name]) c.comment = COMMENTS[c.name];
    const text = lib.emitTsql(t, { db: 'CoreBanking', extra: EXTRA });
    // SSMS varsayılanı: UTF-16 LE, BOM ile
    return { 'CoreBanking.sql': Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]) };
  },
};
