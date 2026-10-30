using Microsoft.EntityFrameworkCore;
using Portal.Domain.Sales;

namespace Portal.Data;

public class PortalDbContext(DbContextOptions<PortalDbContext> options) : DbContext(options)
{
    public DbSet<Dealer> Dealers => Set<Dealer>();
    public DbSet<Region> Regions => Set<Region>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("portal");
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PortalDbContext).Assembly);
    }
}
